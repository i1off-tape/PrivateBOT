const { Client, GatewayIntentBits, ChannelType } = require("discord.js");
const { OpenAI } = require("openai");

// Load environment variables from .env file
require("dotenv").config();

// Initialize the OpenAI client with the API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize the Discord client with specified intents for bot functionality
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages, // Necessary for DM interaction
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.DirectMessageReactions,
  ],
});

// Helper function to pause execution for a set duration
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Event listener for when the bot is ready
client.once("ready", () => {
  console.log("Bot is ready!");
});

// Dictionary to track the end time of DM sessions
const dmSessions = {};
// Mapping of Discord thread IDs to OpenAI thread IDs
const threadMap = {};

// Retrieves the OpenAI thread ID using the Discord thread ID
const getOpenAiThreadId = (discordThreadId) => threadMap[discordThreadId];

// Associates a Discord thread ID with an OpenAI thread ID
const addThreadToMap = (discordThreadId, openAiThreadId) => {
  threadMap[discordThreadId] = openAiThreadId;
};

// Variable to track the next available time to send a request to OpenAI (rate limiting)
let nextAvailableTime = Date.now();

// List of final statuses for OpenAI thread runs
const terminalStates = ["cancelled", "failed", "completed", "expired"];

// Loop to check the status of an OpenAI thread run until it reaches a terminal state
const statusCheckLoop = async (openAiThreadId, runId) => {
  try {
    const run = await openai.beta.threads.runs.retrieve(openAiThreadId, runId);
    if (!terminalStates.includes(run.status)) {
      await sleep(1000); // Wait before rechecking the status
      return statusCheckLoop(openAiThreadId, runId);
    }
    return run.status;
  } catch (error) {
    console.error(`Error retrieving the run status: ${error}`);
    throw error;
  }
};

// Sends a message to the OpenAI thread and returns the response
const addMessage = async (threadId, content) => {
  return openai.beta.threads.messages.create(threadId, {
    role: "user",
    content,
  });
};

// Event listener for message creation in Discord
client.on("messageCreate", async (message) => {
  console.log("Message received: ", message.content); // Debugging message
  if (message.author.bot || !message.content) return;

  // Command to start a new DM session with the bot
  if (
    message.content.startsWith("!create") &&
    message.channel.id === "YOUR_CHANNEL_ID" // Replace with your channel ID
  ) {
    const discordId = message.author.id;
    dmSessions[discordId] = Date.now() + 600000; // Set session end time to 10 minutes in the future
    message.author.send(
      "You have started a DM session with the bot. You have 10 minutes to interact."
    );
    console.log(`Session started for ${discordId}`);
    return;
  }

  // Handling messages in DM
  if (message.channel.type === ChannelType.DM) {
    console.log("Processing DM..."); // Debugging message
    const sessionEndTime = dmSessions[message.author.id];
    if (!sessionEndTime || Date.now() > sessionEndTime) {
      message.author.send(
        "Your session has expired or was not started. Use !create to start a new session."
      );
      console.log(`Session ended or not started for ${message.author.id}`);
      return;
    }

    // Rate limit check before processing the message
    if (Date.now() < nextAvailableTime) {
      await message.reply(
        "Please wait a moment before making the next request."
      );
      return;
    }

    let openAiThreadId = getOpenAiThreadId(message.channel.id);

    if (!openAiThreadId) {
      const thread = await openai.beta.threads.create();
      openAiThreadId = thread.id;
      addThreadToMap(message.channel.id, openAiThreadId);
    }

    try {
      // Simulate bot typing while processing the request
      await message.channel.sendTyping();

      // Add user's message to OpenAI thread and start processing
      await addMessage(openAiThreadId, message.content);
      const run = await openai.beta.threads.runs.create(openAiThreadId, {
        assistant_id: process.env.ASSISTANT_ID, // Ensure you have set your OpenAI Assistant ID in the environment variables
      });

      // Wait for the processing to complete and check the final status
      const status = await statusCheckLoop(openAiThreadId, run.id);

      if (status === "failed") {
        console.log(`Run failed for thread ID ${openAiThreadId}.`);
        await message.reply(
          "An error occurred while processing your request. Please try again later."
        );
        const details = await openai.beta.threads.runs.retrieve(
          openAiThreadId,
          run.id
        );
        if (
          details.last_error &&
          details.last_error.code === "rate_limit_exceeded"
        ) {
          nextAvailableTime = Date.now() + 20 * 1000; // Wait 20 seconds before the next request
        }
      } else if (status === "completed") {
        const messages = await openai.beta.threads.messages.list(
          openAiThreadId
        );
        if (messages.data && messages.data.length > 0) {
          let response = messages.data[0].content[0].text.value;
          response = response.substring(0, 1999); // Truncate to fit Discord message length limit
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

// Log in the bot with your Discord token set in the environment variables
client.login(process.env.DISCORD_TOKEN);
