const path = require("path");
const http = require("http");
const express = require("express");
const socketio = require("socket.io");
const OpenAI = require("openai");

// Grab environment variables so that they can be accessed here

require("dotenv").config();

const formatMessage = require("./utils/messages");
const {
  userJoin,
  getCurrentUser,
  userLeave,
  getRoomUsers,
} = require("./utils/users");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Set static folder
app.use(express.static(path.join(__dirname, "public")));

const assistantName = "ChatCord Assistant";

// Call the OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateResponse(input) {
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [{ role: "assistant", content: input }],
  });

  return chatCompletion.choices[0].message.content;
}

// Run when client wants to
io.on("connection", async (socket) => {
  socket.on("joinRoom", ({ username, room }) => {
    const user = userJoin(socket.id, username, room);
    socket.join(user.room);

    // Welcome a new user

    socket.emit(
      "message",
      formatMessage(assistantName, "Welcome to ChatCord!")
    );

    // Broadcast when a user connects

    socket.broadcast
      .to(user.room)
      .emit(
        "message",
        formatMessage(assistantName, `${user.username} has joined the chat`)
      );

    io.to(user.room).emit("roomUsers", {
      room: user.room,
      users: getRoomUsers(user.room),
    });
  });

  // Listen for chat message

  socket.on("chatMessage", async (msg) => {
    const user = getCurrentUser(socket.id);
    io.to(user.room).emit("message", formatMessage(user.username, msg));

    const response = await generateResponse(msg);
    socket.emit("response", response);
  });

  // socket.on("request", async (msg) => {
  //   const user = getCurrentUser(socket.id);
  //   const response = await generateResponse(msg);
  //   io.to(user.room).emit(response, formatMessage(assistantName, response));
  // });

  // Runs when the client disconnects

  socket.on("disconnect", () => {
    const user = userLeave(socket.id);

    if (user) {
      io.to(user.room).emit(
        "message",
        formatMessage(assistantName, `${user.username} has left the chat`)
      );

      // Send users and room info
      io.to(user.room).emit("roomUsers", {
        room: user.room,
        users: getRoomUsers(user.room),
      });
    }
  });
});

const PORT = 3000 || process.env.PORT;

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
