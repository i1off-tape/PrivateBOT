// Load necessary environment variables
require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js'); // Import discord.js library for Discord bot functionality
const { OpenAI } = require('openai'); // Import OpenAI SDK for generating AI-based responses
const { MongoClient } = require('mongodb'); // Import MongoDB client for database operations

// Initialize the OpenAI client with an API key from the .env file
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize the Discord client with specified intents to listen for guild and message events
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize MongoDB client using the connection URI from the .env file
const mongoClient = new MongoClient(process.env.MONGODB_URI);

// Function to connect to MongoDB and set up necessary indexes for optimized querying
async function connectMongo() {
  try {
    await mongoClient.connect(); // Attempt to connect to the MongoDB database
    console.log('Connected to MongoDB');
    await setupIndexes(); // After successful connection, set up indexes
  } catch (e) {
    console.error('Could not connect to MongoDB', e);
    process.exit(1); // Exit the process if the connection fails
  }
}

// Function to create indexes in the database for improved query performance
async function setupIndexes() {
  try {
    const db = mongoClient.db();
    // Create indexes on the 'channelId' and 'timestamp' fields for collections
    await db.collection('privateMessages').createIndex({ channelId: 1, timestamp: -1 });
    await db.collection('interactions').createIndex({ interactionId: 1 });
    await db.collection('channelDeletions').createIndex({ channelId: 1 });
    console.log('Indexes created.');
  } catch (e) {
    console.error('Could not create indexes', e);
  }
}

connectMongo(); // Connect to MongoDB at startup

// Initialize maps to track OpenAI threads and active channels
const threadMap = {};
const channelsMap = new Map();

// Utility function to pause execution for a given number of milliseconds
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Retrieve the associated OpenAI thread ID for a Discord channel
const getOpenAiThreadId = discordThreadId => threadMap[discordThreadId];

// Map a Discord channel ID to an OpenAI thread ID
const addThreadToMap = (discordThreadId, openAiThreadId) => {
  threadMap[discordThreadId] = openAiThreadId;
};

let nextAvailableTime = Date.now(); // Used to manage rate limiting for API requests

// Specifies the terminal states of an OpenAI thread run, indicating completion or failure.
const terminalStates = ['cancelled', 'failed', 'completed', 'expired']

// Poll the status of an OpenAI thread until it reaches a terminal state
const statusCheckLoop = async (openAiThreadId, runId) => {
  try {
    const run = await openai.beta.threads.runs.retrieve(openAiThreadId, runId);
    if (!terminalStates.includes(run.status)) {
      await sleep(1000); // Wait and check again if the status is not terminal
      return statusCheckLoop(openAiThreadId, runId);
    }
    return run.status; // Return the final status when complete
  } catch (error) {
    console.error(`Error retrieving the run status: ${error}`);
    throw error; // Rethrow the error for higher-level handling
  }
};

// Function to add a message to an OpenAI thread and return the response
const addMessage = async (threadId, content) => {
  return openai.beta.threads.messages.create(threadId, {
    role: 'user',
    content,
  });
};

// Perform a database operation with error handling
async function withDb(operation) {
  try {
    const db = mongoClient.db();
    await operation(db); // Execute the provided database operation
  } catch (error) {
    console.error('Error during DB operation:', error);
  }
}

// Event listener for when the bot becomes ready to start working
client.once('ready', () => {
  console.log('Bot is ready!');
});

// Main event listener for handling message creation in Discord
client.on('messageCreate', async message => {
  if (message.author.bot || !message.content) return; // Ignore messages from bots or empty messages

  // Example: Handle a command to create a private channel
  if (message.content.startsWith('!createPrivateChannel') && message.channelId === 'YOUR_COMMAND_CHANNEL_ID') {
        // Extracting the user's ID to create a unique channel name
        const channelName = `private-${message.author.id}`;
        try {
          // Create a new private text channel for the user
          const channel = await message.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            // Optional: specify a parent category ID if you want the channel to be created in a specific category
            parent: 'YOUR_MAIN_CHANNEL_ID',
            permissionOverwrites: [
              {
                id: message.guild.id,
                deny: [PermissionFlagsBits.ViewChannel], // Deny everyone else from viewing the channel
              },
              {
                id: message.author.id,
                allow: [
                  PermissionFlagsBits.ViewChannel, // Allow the user to view, send messages, and read message history in the channel
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                ],
              },
            ],
          });
    
          // Store the created channel's ID for later reference
          channelsMap.set(channel.id, channel);
    
          // Send a welcome message in the private channel with a button to close the ticket (delete the channel)
          const closeButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('close_ticket')
              .setLabel('Close ticket')
              .setStyle(ButtonStyle.Danger)
          );
          await channel.send({
            content: "Hello, I'm IO ASSISTANT. How can I help you?",
            components: [closeButton],
          });
    
          // Notify the user in the original channel that their private channel has been created
          await message.reply(`Private channel ${channel} created. It will be deleted in 10 minutes.`);
    
          // Save the channel creation event to the database
          withDb(async db => {
            const eventsCollection = db.collection('events');
            await eventsCollection.insertOne({
              eventType: 'Channel Creation',
              channelId: channel.id,
              creatorId: message.author.id,
              timestamp: new Date(),
            });
          });
    
          // Automatically delete the channel after 10 minutes
          setTimeout(async () => {
            if (channelsMap.has(channel.id)) {
              try {
                const fetchedChannel = await client.channels.fetch(channel.id);
                if (fetchedChannel) {
                  await fetchedChannel.delete();
                  console.log(`Channel ${fetchedChannel.name} has been automatically deleted.`);
    
                  // Save the channel deletion event to the database
                  withDb(async db => {
                    const channelDeletionsCollection = db.collection('channelDeletions');
                    await channelDeletionsCollection.insertOne({
                      eventType: 'Channel Deletion',
                      channelId: fetchedChannel.id,
                      deletedAt: new Date(),
                    });
                  });
                }
              } catch (error) {
                console.error(`Error during automatic channel deletion: ${error}`);
              } finally {
                channelsMap.delete(channel.id);
              }
            }
          }, 600000); // 600,000 milliseconds = 10 minutes
        } catch (error) {
          console.error('Error creating private channel:', error);
          await message.reply('Failed to create private channel.');
        }
        return;
      }
    
      // Additional bot functionality, such as responding to messages or handling other commands, would go here
      // Example: Responding to messages in private channels with AI-generated responses
if (message.channel.type === ChannelType.GuildText && message.channel.name.startsWith('private-')) {
    if (Date.now() < nextAvailableTime) {
      await message.reply('Please wait a moment before making the next request.');
      return;
    }
  
    let openAiThreadId = getOpenAiThreadId(message.channel.id);
  
    if (!openAiThreadId) {
      // If there's no OpenAI thread associated with this Discord channel, create a new one
      const thread = await openai.beta.threads.create();
      openAiThreadId = thread.id;
      addThreadToMap(message.channel.id, openAiThreadId);
    }
  
    try {
      await message.channel.sendTyping(); // Show typing indicator while generating the response
  
      // Add the user's message to the OpenAI thread for context and generate a response
      await addMessage(openAiThreadId, message.content);
      const run = await openai.beta.threads.runs.create(openAiThreadId, {
        assistant_id: process.env.ASSISTANT_ID, // Use your specific OpenAI Assistant ID here
      });
  
      // Check the run status until it's completed or failed
      const status = await statusCheckLoop(openAiThreadId, run.id);
  
      if (status === 'failed') {
        console.log(`Run failed for thread ID ${openAiThreadId}.`);
        await message.reply('An error occurred while processing your request. Please try again later.');
        // Adjusts the rate limiting based on the error details if needed
				const details = await openai.beta.threads.runs.retrieve(
					openAiThreadId,
					run.id
				)
				if (
					details.last_error &&
					details.last_error.code === 'rate_limit_exceeded'
				) {
					nextAvailableTime = Date.now() + 20 * 1000 // Wait an additional 20 seconds
				}
      } else if (status === 'completed') {
        // Retrieve the messages from the OpenAI thread, including the generated response
        const messages = await openai.beta.threads.messages.list(openAiThreadId);
        if (messages.data && messages.data.length > 0) {
          // Correctly accessing the response based on the actual structure
          let response = messages.data[0].content[0].text.value;
          response = response.substring(0, 1999); // Ensure the response does not exceed Discord's message limit
          console.log(`Response from OpenAI: ${response}`);
          await message.reply(response);
          
          // Save the interaction (both the query and the response) in the database
          withDb(async db => {
            const privateMessagesCollection = db.collection('privateMessages');
            await privateMessagesCollection.insertOne({
              channelId: message.channel.id,
              userId: message.author.id,
              messageContent: message.content,
              responseContent: response,
              timestamp: new Date(),
            });
          });
        }
      }
    } catch (error) {
      console.error(`Error during message processing: ${error}`);
      await message.reply('An error occurred while processing your message.');
    }
  }
  
});
    
    // Listen for interactions, like button presses
    client.on('interactionCreate', async interaction => {
      if (!interaction.isButton() || interaction.customId !== 'close_ticket') return;
    
      const channel = channelsMap.get(interaction.channelId);
      if (channel) {
        try {
          // Delete the channel based on the user's interaction
          await channel.delete();
          console.log(`Channel ${channel.name} has been deleted by user interaction.`);
    
          // Remove the channel from the map
          channelsMap.delete(interaction.channelId);
        } catch (error) {
          console.error(`Error deleting channel by interaction: ${error}`);
        }
      }
    });
    
    // Gracefully handle bot shutdown 
    function handleExit() {
      mongoClient.close(() => {
        console.log('MongoDB connection closed.');
        process.exit();
      });
    }
    
    // Capture exit signals for graceful shutdown
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
    
    // Log in to Discord with your app's token
    client.login(process.env.DISCORD_TOKEN);
    
