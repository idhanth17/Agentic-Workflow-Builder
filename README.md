# 🤖 Agentic Workflow Builder

A powerful full-stack application for building, executing, and monitoring multi-step AI workflows. It features a React frontend, Node.js/Express backend, PostgreSQL database, and real-time WebSocket communication.

## 🚀 Features

-   **Visual Workflow Builder**: Define steps, prompts, and models (GPT-4, Claude 3.5, Gemini, etc.).
-   **Agentic Execution**: Chained execution where the output of one step feeds into the context of the next.
-   **Real-time Monitoring**: Watch step-by-step progress via WebSockets with stable connection handling.
-   **Reliability**: Automatic retries, criteria evaluation (JSON/Regex validation), and model fallback switching.

## 🛠️ Tech Stack

-   **Frontend**: React, Vite, CSS Modules
-   **Backend**: Node.js, Express, `ws` (WebSocket)
-   **Database**: PostgreSQL
-   **AI Integration**: Unbound API (Unified interface for LLMs)

## 📦 Prerequisites

-   Node.js (v18+)
-   PostgreSQL (Local or Cloud)
-   Unbound API Key

## ⚡ Local Setup

### 1. Clone the repository
```bash
git clone https://github.com/idhanth17/Agentic-Workflow-Builder.git
cd Agentic-Workflow-Builder
```

### 2. Backend Setup
```bash
cd backend
npm install

# Create .env file
cp .env.example .env 
# (Or manually create .env and add your UNBOUND_API_KEY and DATABASE_URL)
```

**Required `.env` variables for Backend:**
```ini
PORT=5000
WS_PORT=5001
DATABASE_URL=postgresql://user:password@localhost:5432/workflow_builder
UNBOUND_API_KEY=sk_...
UNBOUND_API_URL=https://api.getunbound.ai/v1
```

### 3. Frontend Setup
```bash
cd ../frontend
npm install
```

### 4. Database Initialization
Ensure your PostgreSQL server is running. The backend will automatically create tables (`schema.js`) on the first run.
Optionally, seed sample data:
```bash
cd backend
npm run seed
```

### 5. Run the Application
You need two terminals:

**Terminal 1 (Backend)**:
```bash
cd backend
npm start
```

**Terminal 2 (Frontend)**:
```bash
cd frontend
npm run dev
```

Open `http://localhost:3000` (or the port shown by Vite) to view the app.

## ☁️ Deployment Guide (Render.com)

### 1. Database
-   Create a **PostgreSQL** database on Render.
-   Copy the `Internal Database URL`.

### 2. Backend (Web Service)
-   **Root Directory**: `backend`
-   **Build Command**: `npm install`
-   **Start Command**: `npm start`
-   **Environment Variables**:
    -   `DATABASE_URL`: (Paste Internal DB URL)
    -   `UNBOUND_API_KEY`: (Your Key)
    -   `WS_PORT`: `10000` (Render only exposes one port, so the app might need adjustment to run WS on the same server instance if not using a separate service). *Note: The current code runs HTTP on 5000 and WS on 5001. For single-port deployment, ensure the WS server attaches to the HTTP server.*

### 3. Frontend (Static Site)
-   **Root Directory**: `frontend`
-   **Build Command**: `npm install && npm run build`
-   **Publish Directory**: `dist`
-   **Environment Variables**:
    -   `VITE_API_URL`: `https://your-backend-service.onrender.com/api`
    -   `VITE_WS_URL`: `wss://your-backend-service.onrender.com`

## 🛡️ Stability Notes

-   **WebSockets**: The app includes a "Heartbeat" mechanism (Ping/Pong every 5s) to prevent browser or proxy timeouts.
-   **Large Payloads**: Real-time broadcasts are optimized to exclude huge text chunks to prevent socket crashes; full data is retrieved via REST API on completion.
