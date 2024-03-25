# NodeJS Discord Bot Using the new OpenAI Assistants API (modification by I1OFF)

In this repo we integrate Discord.js with the new OpenAI Assistants API. The bot operates within Discord channels, listening to messages and using OpenAI to generate responses.

## Features

- **Discord Integration**: The bot listens to messages in Discord channels.
- **OpenAI Response Generation**: Leverages the new OpenAI Assistants API to create responses to messages.
- **Message Thread Tracking**: Maintains message threads for continuity in conversations.
- **NEW Assistants Capabilities**: Since the bot uses Assistants, you no longer have to worry about context management and you can also benefit from assistant capabilities such as `code interpreter` and knowledge `retrieval`

## Prerequisites

- Node.js installed on your machine.
- A Discord bot token (from Discord Developer Portal).
- An OpenAI API key.
- An Assistent ID
- An MongoDB_URI

## Installation

1. **Clone the Repository**:
   ```
   git clone [repository-url]
   ```
2. **Navigate to the Repository Folder**:
   ```
   cd openai-assistants-discord-bot
   ```
3. **Install Dependencies**:
   ```
   npm install
   ```
4. **Install MongoDB**:
   ```
   npm install mongodb
   ```

## Configuration

1. **Set Up Environment Variables**:
   Create a `.env` file in the root of your project with the following variables:
   mv .env.sample .env 
   ```
   MONGODB_URI=your_uri_mongodb
   DISCORD_TOKEN=your_discord_bot_token
   OPENAI_API_KEY=your_openai_api_key
   ASSISTANT_ID=your_openai_assistant_id
   ```

## Running the Bot

1. **Start the Bot**:
   ```
   node ionetbot.js
   ```
   OR
   ```
   nodemon ionetbot.js
   ```
   
## Usage

- **Interaction:** Simply type and send messages in your Discord server where the bot is added. For instance, when a user sends a message in a designated command channel (e.g., using !createPrivateChannel), the bot will automatically create a private channel for them, offering a personalized space for further interaction.

- **Private Channels:** The bot is capable of creating private channels upon specific commands. Within these private channels, users can interact with the bot, receiving AI-generated responses to their queries based on the OpenAI model's output. For example, after a private channel is created, the user can ask financial advice or information, and the bot will provide responses tailored to the user's request.

- **Discord Channels:** The bot operates in any text channel or thread where it has been granted permissions to read and send messages. It's designed to engage users in public channels as well, where it can provide information or responses as programmed. For instance, if it's integrated with functionalities to offer financial insights, a user could ask for the latest cryptocurrency rates in a public channel, and the bot would respond accordingly.

This revised section now accurately reflects the specific functionalities of your bot without implying the capability to interact via DMs, focusing on its strengths in providing information and engaging users through both public channels and specifically created private channels.

## Contributing

Feel free to fork the repository and submit pull requests.

## License

MIT
