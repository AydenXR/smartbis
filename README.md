# SmartBis: Intelligent Business Automation & AI Assistant

SmartBis is a professional-grade AI orchestration platform designed to transform business communication and administrative operations. It leverages Large Language Models (LLMs) to provide autonomous customer support, appointment scheduling, and lead management via WhatsApp and Messenger.

## Overview

The SmartBis platform acts as a Virtual Business Manager. It is designed to be industry-agnostic, capable of supporting diverse sectors—from medical clinics and professional services to retail and hospitality—by simply adjusting its knowledge base and mission parameters.

### Core Capabilities

- **Autonomous Customer Service:** Natural conversation handling using Retrieval-Augmented Generation (RAG) to ensure accuracy based on business-specific documentation.
- **Dynamic Appointment Scheduling:** Full integration with digital calendars to check availability and book slots without human intervention.
- **Support Ticket Management:** Automated generation and tracking of customer requests, purchase orders, and enrollment forms.
- **Multi-Channel Presence:** Unified communication across WhatsApp and Facebook Messenger.
- **Knowledge Base (Notebook):** Support for Markdown-based knowledge files that the AI consumes to resolve queries.
- **Administrative Control Panel:** A dedicated web interface for monitoring tickets, managing the calendar, and supervising AI interactions.

---

## Architecture and Technology Stack

The platform is built on a modular, containerized architecture:

- **Back-end Orchestrator:** Node.js server managing LLM interactions, tool execution, and database connectivity.
- **Vector Database:** Qdrant for storing and retrieving high-dimensional embeddings for RAG.
- **Agent Logic:** Highly configurable system prompts (stored in the `soul/` directory) and tool-calling capabilities.
- **Persistence:** Local JSON-based storage for lightweight configurations and structured data (Tickets, Reminders, Finances).
- **Communication Layer:** Baileys for WhatsApp integration and Meta Platform APIs for Messenger.
- **Containerization:** Docker/Docker Compose for isolated, predictable deployments.

---

## Installation and Deployment

### Prerequisites

- Docker and Docker Compose installed on a Linux-based VPS.
- API keys for X.AI (Grok) or OpenAI.
- Meta Developer account for Messenger integration.
- A Cloudfare Tunnel token for secure external access.

### Setup Wizard

SmartBis includes a deployment wizard to simplify the initialization process.

1. Clone the repository to your server.
2. Ensure `setup-deployment.sh` is executable:
   ```bash
   chmod +x setup-deployment.sh
   ```
3. Run the wizard:
   ```bash
   ./setup-deployment.sh
   ```

The script will guide you through configuring:
- Business name and industry type.
- Contact information (Address and Phone).
- API keys and administration passwords.
- Container networking and port allocation.

---

## System Configuration and Personalization

### The Notebook Folder
The `/notebook` directory is the AI's "source of truth". All `.md` files in this folder are indexed into the vector database. The agent will only use information found here to answer customer questions about products, services, or procedures.

### The Soul Folder
The `/soul` directory contains the system prompt (`prompt.md`). This defines the agent's persona, tone, and specific business rules. It is recommended to use the generated prompt and refine it based on business requirements.

---

## Migration and Scaling

SmartBis supports multi-tenant logic and container isolation. To migrate an instance:
1. Back up the `/data`, `/notebook`, and `/soul` directories.
2. Transfer these to the new server environment.
3. Update the `.env` file with the new server's networking specifications.
4. Execute `docker compose up -d --build` to re-instantiate the environment.

---

## Compliance and Security

By default, SmartBis runs in an isolated containerized environment. Administrators are advised to:
- Monitor the `bot.log` located in the `/data` directory.
- Rotate administrative passwords regularly via the Panel.
- Secure API keys within the environment variables.

---

## Licensing and Support

This software is provided for professional business automation. For support, custom integrations, or advanced modules, please contact the repository administrator.
