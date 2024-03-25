const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { OpenAI } = require("openai");
require("dotenv").config();

// Initialize the OpenAI client with the API key stored in environment variables.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize the Discord client with necessary intents for listening to messages and guild information.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Utility function to pause execution for a set amount of milliseconds.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Maps for tracking threads related to OpenAI interactions and private Discord channels.
const threadMap = {}; // Maps Discord channel IDs to OpenAI thread IDs.
const channelsMap = new Map(); // Tracks Discord channels using their IDs for easy access.

// Retrieves the corresponding OpenAI thread ID for a given Discord channel ID.
const getOpenAiThreadId = (discordThreadId) => threadMap[discordThreadId];

// Associates a Discord channel with an OpenAI thread.
const addThreadToMap = (discordThreadId, openAiThreadId) => {
  threadMap[discordThreadId] = openAiThreadId;
};

// Tracks the time at which the next request to OpenAI can be made, used for rate limiting.
let nextAvailableTime = Date.now();

// Specifies the terminal states of an OpenAI thread run, indicating completion or failure.
const terminalStates = ["cancelled", "failed", "completed", "expired"];

// Polls OpenAI for the status of a thread run, waiting for it to reach a terminal state.
const statusCheckLoop = async (openAiThreadId, runId) => {
  try {
    const run = await openai.beta.threads.runs.retrieve(openAiThreadId, runId);
    if (!terminalStates.includes(run.status)) {
      await sleep(1000); // Pause for a second before checking the status again.
      return statusCheckLoop(openAiThreadId, runId); // Recursively check the status.
    }
    return run.status; // Return the final status of the run.
  } catch (error) {
    console.error(`Error retrieving the run status: ${error}`);
    throw error;
  }
};

// Adds a message from a user to the corresponding OpenAI thread.
const addMessage = async (threadId, content) => {
  return openai.beta.threads.messages.create(threadId, {
    role: "user",
    content,
  });
};

client.once("ready", () => {
  console.log("Bot is ready!");
});

client.on("messageCreate", async (message) => {
  // Ignore messages from bots or messages without content.
  if (message.author.bot || !message.content) return;

  // Command to create a private channel.
  if (
    message.content.startsWith("!createPrivateChannel") &&
    message.channelId === "your_id" // Placeholder: your specific channel ID for commands.
  ) {
    const channelName = `private-${message.author.id}`;
    try {
      // Creates a new private channel with specific permissions.
      const channel = await message.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: "your_id", // Placeholder: parent category ID for organizing channels.
        permissionOverwrites: [
          {
            id: message.guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: message.author.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ],
      });

      // Stores the newly created channel in the channelsMap for tracking.
      channelsMap.set(channel.id, channel);

      // Creates a button that allows users to close the ticket (delete the channel).
      const closeButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Close ticket")
          .setStyle(ButtonStyle.Danger)
      );

      // Sends a greeting message in the private channel with the "Close ticket" button.
      await channel.send({
        content: "Hello, I'm IO ASSISTANT. How can I help you?",
        components: [closeButton],
      });

      // Notifies the user that the private channel has been created.
      await message.reply(
        `Private channel ${channel} created. It will be deleted in 10 minutes.`
      );

      // Schedules automatic deletion of the channel after 10 minutes.
      setTimeout(async () => {
        if (channelsMap.has(channel.id)) {
          try {
            const fetchedChannel = await client.channels.fetch(channel.id);
            if (fetchedChannel) {
              await fetchedChannel.delete();
              console.log(
                `Channel ${fetchedChannel.name} has been automatically deleted after 10 minutes.`
              );
            }
          } catch (error) {
            console.error(`Error during automatic channel deletion: ${error}`);
          } finally {
            channelsMap.delete(channel.id); // Ensures the channel is removed from the map.
          }
        }
      }, 600000); // 10 minutes in milliseconds.
    } catch (error) {
      console.error("Error creating private channel:", error);
      await message.reply("Failed to create private channel.");
    }
    return;
  }

  // Handle messages in private channels, possibly including interactions with OpenAI.
  if (
    message.channel.type === ChannelType.GuildText &&
    message.channel.name.startsWith("private-")
  ) {
    // Check for rate limiting before processing the message.
    if (Date.now() < nextAvailableTime) {
      await message.reply(
        "Please wait a moment before making the next request."
      );
      return;
    }

    let openAiThreadId = getOpenAiThreadId(message.channel.id);

    if (!openAiThreadId) {
      // If no OpenAI thread is associated with this channel, create a new one.
      const thread = await openai.beta.threads.create();
      openAiThreadId = thread.id;
      addThreadToMap(message.channel.id, openAiThreadId);
    }

    try {
      // Simulate typing to indicate that the bot is processing the request.
      await message.channel.sendTyping();

      // Add the user's message to the OpenAI thread and initiate processing.
      await addMessage(openAiThreadId, message.content);
      const run = await openai.beta.threads.runs.create(openAiThreadId, {
        assistant_id: process.env.ASSISTANT_ID, // Placeholder: your specific OpenAI assistant ID.
      });

      // Wait for the processing to complete and check the final status.
      const status = await statusCheckLoop(openAiThreadId, run.id);

      if (status === "failed") {
        console.log(`Run failed for thread ID ${openAiThreadId}.`);
        // Provide feedback to the user in case of a failure.
        await message.reply(
          "An error occurred while processing your request. Please try again later."
        );
        // Adjusts the rate limiting based on the error details if needed
        const details = await openai.beta.threads.runs.retrieve(
          openAiThreadId,
          run.id
        );
        if (
          details.last_error &&
          details.last_error.code === "rate_limit_exceeded"
        ) {
          nextAvailableTime = Date.now() + 20 * 1000; // Wait an additional 20 seconds
        }
      } else if (status === "completed") {
        // Fetch the responses from the OpenAI thread
        const messages = await openai.beta.threads.messages.list(
          openAiThreadId
        );
        if (messages.data && messages.data.length > 0) {
          // Extract and send the most recent response to the Discord channel
          let response = messages.data[0].content[0].text.value;
          response = response.substring(0, 1999);
          console.log(`Response from OpenAI: ${response}`);
          await message.reply(response);
        }
      }
    } catch (error) {
      console.error(`Error during message processing: ${error}`);
      await message.reply("An error occurred while processing your message.");
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  // Handles user interactions, specifically button presses in this context
  if (!interaction.isButton() || interaction.customId !== "close_ticket")
    return;

  const channel = channelsMap.get(interaction.channelId);

  if (channel) {
    // Retrieve the name before deletion for logging purposes
    const channelName = channel.name;

    try {
      // Attempt to delete the channel based on the user's request
      await channel.delete();
      channelsMap.delete(interaction.channelId); // Remove the channel from the map to clean up
      console.log(
        `Channel ${channelName} has been deleted by user interaction.`
      );
    } catch (error) {
      console.error(`Error deleting channel by interaction: ${error}`);
    }
  } else {
    console.error(
      "Attempted to delete a channel that does not exist or was not tracked."
    );
  }
});

// Login the bot using the token from the .env file
client.login(process.env.DISCORD_TOKEN);
