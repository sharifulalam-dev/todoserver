# Task Manager Backend

## Short Description

This is the backend for the Task Manager application, offering APIs for task creation, user authentication, and real-time task updates. It supports user sign-up/sign-in via Firebase (email/password or Google login), stores task information in a MongoDB database, and utilizes Socket.IO for real-time updates.

## Live Links

- **Backend (Vercel)**: [https://todo-server-alpha-sand.vercel.app](https://todo-server-alpha-sand.vercel.app)

## Dependencies

- **Express**: Minimal and flexible Node.js web application framework.
- **Axios**: Promise-based HTTP client for making requests from the frontend to the backend.
- **Socket.IO**: Real-time, bidirectional communication between the frontend and backend.
- **MongoDB**: NoSQL database used to store tasks and user data.
- **Firebase Authentication**: Authentication service to allow users to sign up, sign in, and reset passwords.
- **JWT (JSON Web Token)**: Securely transmits data between the client and the server.
- **CORS**: Middleware for enabling cross-origin requests.
- **dotenv**: Loads environment variables from a `.env` file for secure configuration.

## Installation Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/sharifulalam-dev/todoserver.git
   cd todo-server
   ```
