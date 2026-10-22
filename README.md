# 🎫 TicketBari – Backend Server

TicketBari is an online ticket booking platform designed to make ticket discovery, booking, and payment management easier for users. This repository contains the backend server, which provides APIs for ticket management, user authentication, bookings, payments, and administrative operations.

The backend is built with Node.js, Express.js, and MongoDB to provide a reliable foundation for the TicketBari application.

---

## 🌐 Live Project

🔗 **Live Website:** [TicketBari](https://ticket-bari-client-black.vercel.app)

---

## 🚀 Technologies Used

- Node.js
- Express.js
- MongoDB
- Better Auth JWT verification
- JOSE
- Stripe
- dotenv
- CORS
- Vercel

---

## ✨ Features

- 🔌 RESTful API endpoints
- 🎫 Ticket creation and management
- 🔍 Retrieve ticket information
- 🔐 JWT-based authentication and token verification
- 👥 User management and role-based authorization
- 📋 Booking creation and booking management
- ✅ Accept or reject booking requests
- 💳 Payment processing integration with Stripe
- 💰 Store payment and transaction records
- 🛡️ Protected routes for authorized users
- 👨‍💼 Administrative ticket and user management
- 📢 Advertisement management
- 🗄️ MongoDB database integration
- 🌍 Cross-origin resource sharing (CORS)
- ☁️ Backend deployment support with Vercel

---

## 📦 Dependencies

Major packages and technologies used in this project include:

- `express`
- `mongodb`
- `dotenv`
- `cors`
- `jose-cjs`
- Stripe SDK, if configured in the server
- `nodemon` for development, if installed

For the complete dependency list, check the `package.json` file.

---

## ⚙️ Run Locally

### 1. Clone the Repository

```bash
git clone https://github.com/jahidhasan-devs/Online-Ticket-Booking-Platform-Server.git
```

### 2. Navigate to the Project Folder

```bash
cd Online-Ticket-Booking-Platform-Server
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the root directory and add the environment variables required by your backend configuration.

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
CLIENT_URL=http://localhost:3000
```

Add any additional variables required by your application, such as authentication or payment configuration.

**Important:** Use your actual environment variable names from the source code. Never commit your `.env` file or expose database credentials, authentication secrets, or Stripe secret keys.

### 5. Start the Server

For development with Nodemon:

```bash
npx nodemon index.js
```

Alternatively, if your `package.json` defines a start script:

```bash
npm start
```

The backend should run at:

```text
http://localhost:5000
```

---

## 🔗 Resources

### 🌐 Live Website

[TicketBari – Online Ticket Booking Platform](https://ticket-bari-client-black.vercel.app)

### 💻 Client Repository

[GitHub – TicketBari Client](https://github.com/jahidhasan-devs/Online-Ticket-Booking-Platform-Client)

### 💻 Server Repository

[GitHub – TicketBari Server](https://github.com/jahidhasan-devs/Online-Ticket-Booking-Platform-Server)

---

## 👨‍💻 Author

**Jahid Hasan**

🌐 **GitHub Profile:** [jahidhasan-devs](https://github.com/jahidhasan-devs)
