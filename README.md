# VK Group Monitor with AI-Powered Post Rewriting

## 🚀 Overview

This project is an advanced VK (VKontakte) group monitor that automatically
fetches new posts from specified groups, rewrites them using AI, and stores both
the original and rewritten versions. It's built with TypeScript, uses Ollama for
AI-powered text generation, and leverages LevelDB for efficient data storage.

## 🌟 Features

- 🔄 Real-time monitoring of multiple VK groups
- 🤖 AI-powered post rewriting using Ollama
- 💾 Efficient storage of posts and group states with LevelDB
- 🐳 Docker and Docker Compose support for easy deployment
- 🔌 Event-driven architecture for extensibility

## 🛠 Tech Stack

- TypeScript
- Node.js
- VK Bridge API
- Ollama AI
- LevelDB
- Docker & Docker Compose

## 🚀 Quick Start

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/vk-group-monitor.git
   cd vk-group-monitor
   ```

2. Create a `.env` file in the project root and add your configuration:

   ```
   VK_ACCESS_TOKEN=your_vk_access_token
   GROUP_IDS=123456,789012
   POLL_INTERVAL=60000
   POSTS_PER_REQUEST=100
   OLLAMA_HOST=http://ollama:11434
   OLLAMA_MODEL=llama2
   OLLAMA_PROMPT="Rewrite the following social media post in a more engaging way, keeping the main message intact:"
   ```

3. Build and run the project using Docker Compose:

   ```bash
   docker-compose up --build
   ```

## 📚 How It Works

1. The app connects to specified VK groups and fetches new posts at regular
   intervals.
2. New posts are sent to the Ollama AI service for rewriting.
3. Both original and rewritten posts are stored in LevelDB.
4. The app emits events for new posts, processed posts, and errors, allowing for
   easy integration with other systems.

## 🛠 Development

To set up the project for development:

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run in development mode:

   ```bash
   npm run dev
   ```

3. Build the project:

   ```bash
   npm run build
   ```

4. Run the built version:
   ```bash
   npm start
   ```

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check
[issues page](https://github.com/yourusername/vk-group-monitor/issues).

## 📜 License

This project is [MIT](https://choosealicense.com/licenses/mit/) licensed.

## 🙏 Acknowledgements

- [VK Bridge](https://dev.vk.com/bridge/overview)
- [Ollama](https://ollama.ai/)
- [LevelDB](https://github.com/Level/level)
