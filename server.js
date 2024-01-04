// Author: Andrew Naumann
// Description: Language Learning tool

// Import packages and libraries --------------------------------------------------------

const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const session = require("express-session");
const socketio = require("socket.io");
const OpenAI = require("openai");
const speechFile = path.resolve("audio.mp3");

// Grab environment variables so that they can be accessed here --------------------------

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

// Set static folder ----------------------------------------------------------------------

app.use(express.static(path.join(__dirname, "public")));

// Setup Express Session to Login and stuff -----------------------------------------------

app.use(
  session({
    secret: "Finnish",
    resave: false,
    saveUninitialized: false,
  })
);

// Create middleware to authenticate the user ------------------------------------------------

const authenticateUser = (req, res, next) => {
  if (req.session && req.session.user) {
    // If the user is authenticated, pass the user data to the next middleware
    res.locals.user = req.session.user;
  } else {
    res.locals.user = undefined;
  }
  // Continue to the next middleware even if the user is not authenticated
  next();
};

app.use(authenticateUser);

// Set view engine to EJS ------------------------------------------------

app.set("view engine", "ejs");

const assistantName = "ChatCord Assistant";

// Call the OpenAI API ------------------------------------------------

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let chatHistory = [];

// Function to generate a response from a query using the chatgpt api -------------------------------

async function generateResponse(input) {
  const chatCompletion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    // messages: [{ role: "assistant", content: input }],
    messages: input,
  });

  return chatCompletion.choices[0].message.content;
}

// SOCKET IO STUFF ------------------------------------------------------------------------------------

io.on("connection", async (socket) => {
  console.log("a user connected");
  socket.on("chat message", function (msg) {
    console.log("message: " + msg);
  });

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

  // Listen for chat message -------------

  socket.on("chatMessage", async (msg) => {
    // Map chat history stuff

    const messages = chatHistory.map(([role, content]) => ({
      role,
      content,
    }));

    const user = getCurrentUser(socket.id);
    io.to(user.room).emit("message", formatMessage(user.username, msg));

    messages.push({ role: "user", content: msg });

    // Generate the response in the foreign language

    const response = await generateResponse(messages);
    socket.emit("response", response);

    // Add the query and response to the chat history

    chatHistory.push(["user", msg]);
    chatHistory.push(["assistant", response]);

    // Generate an english translation of the text

    // let translate =
    //   "Output just the english translation of " +
    //   response +
    //   " and nothing else.";

    // let trans = await generateResponse([{ role: "user", content: translate }]);

    // socket.emit("translation", trans);

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "shimmer",
      input: response,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    await fs.promises.writeFile(speechFile, buffer);
  });

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

// EXPRESS ROUTES --------------------------------------------------------------------------------------

app.get("/chat", (req, res) => {
  res.render("chat", {
    user: res.locals.user,
  });
});

app.get("/", (req, res) => {
  res.render("landing", { user: res.locals.user });
});

const PORT = 3001 || process.env.PORT;

server.listen(PORT, () => console.log(`Server running on ${PORT}`));
