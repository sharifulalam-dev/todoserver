require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const http = require("http");
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

// ENV
const port = process.env.PORT || 9000;
// Replace JWT_SECRET with ACCESS_TOKEN_SECRET in .env
const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || "mydefaultsecret";

// EXPRESS
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:5174"],
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(cookieParser());

// MONGODB SETUP
const uri = "mongodb://127.0.0.1:27017";
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;
let usersCollection;
let tasksCollection;

async function initializeMongoDB() {
  try {
    await client.connect();
    db = client.db("todolist");
    usersCollection = db.collection("users");
    tasksCollection = db.collection("tasks");

    // Create indexes for tasks: category + order, and userId
    await tasksCollection.createIndexes([
      { key: { category: 1, order: 1 } },
      { key: { userId: 1 } },
    ]);

    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
});
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// AUTH MIDDLEWARE
function auth(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ message: "No token provided." });
    }
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
    req.user = { id: decoded.userId };
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ message: "Invalid token." });
  }
}

// Start the server after DB initializes
async function startServer() {
  await initializeMongoDB();
  httpServer.listen(port, () => {
    console.log(`Todoapp running on port ${port}`);
  });
}
startServer();

// ======================= ROUTES ======================= //

// 1) /users route - create/update user, issue JWT in a cookie
app.post("/users", async (req, res) => {
  try {
    const { name, email, image } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ message: "email is required to store user data" });
    }

    // Check if user with this email exists
    let user = await usersCollection.findOne({ email });

    if (!user) {
      // Create new user document
      const newUserDoc = {
        name: name || "NoName",
        email,
        image: image || null,
        createdAt: new Date(),
      };
      const result = await usersCollection.insertOne(newUserDoc);
      user = { ...newUserDoc, _id: result.insertedId };
    } else {
      // Update user fields if needed
      const updates = {
        name: name || user.name,
        image: image || user.image,
      };
      await usersCollection.updateOne({ _id: user._id }, { $set: updates });
      user = { ...user, ...updates };
    }

    // Generate JWT referencing user._id
    const payload = { userId: user._id.toString() };
    const token = jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: "1h" });

    // Set a cookie named "token"
    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // set true if using HTTPS in production
      sameSite: "lax",
    });

    return res.status(200).json({ message: "User stored/updated", user });
  } catch (err) {
    console.error("Error in /users:", err);
    return res
      .status(500)
      .json({ message: "Internal server error", error: err.message });
  }
});

// 2) Logout - clears the cookie
app.post("/logout", (req, res) => {
  res.clearCookie("token");
  return res.json({ message: "Logged out successfully." });
});

// 3) Protected tasks routes: require a valid JWT cookie
// CREATE a new task
app.post("/tasks", auth, async (req, res) => {
  try {
    const { title, description, category } = req.body;
    if (!title) {
      return res.status(400).json({ message: "Title is required." });
    }
    if (title.length > 50) {
      return res
        .status(400)
        .json({ message: "Title must be 50 characters or less." });
    }
    if (description && description.length > 200) {
      return res
        .status(400)
        .json({ message: "Description must be 200 characters or less." });
    }

    const userId = req.user.id; // from JWT
    const cat = category || "To-Do";

    // Calculate next order in this category for this user
    const maxOrderDoc = await tasksCollection
      .find({ userId, category: cat })
      .sort({ order: -1 })
      .limit(1)
      .toArray();
    const order = maxOrderDoc.length > 0 ? (maxOrderDoc[0].order || 0) + 1 : 0;

    const task = {
      title,
      description: description || "",
      category: cat,
      order,
      userId, // store which user created it
      createdAt: new Date(),
    };

    const result = await tasksCollection.insertOne(task);
    const newTask = { ...task, _id: result.insertedId };

    // Inform other clients via Socket.IO
    io.emit("taskCreated", newTask);
    return res.status(201).json(newTask);
  } catch (error) {
    console.error("Error creating task:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// READ tasks for the logged-in user
app.get("/tasks", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const tasks = await tasksCollection
      .find({ userId })
      .sort({ category: 1, order: 1 })
      .toArray();
    return res.status(200).json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// UPDATE a task
app.put("/tasks/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, order } = req.body;
    const userId = req.user.id;

    // Find the original task
    const originalTask = await tasksCollection.findOne({
      _id: new ObjectId(id),
      userId,
    });
    if (!originalTask) {
      return res.status(404).json({ message: "Task not found or not yours." });
    }

    const updateFields = {};
    if (title !== undefined) {
      if (!title) {
        return res.status(400).json({ message: "Title cannot be empty." });
      }
      if (title.length > 50) {
        return res
          .status(400)
          .json({ message: "Title must be 50 characters or less." });
      }
      updateFields.title = title;
    }
    if (description !== undefined) {
      if (description.length > 200) {
        return res
          .status(400)
          .json({ message: "Description must be 200 characters or less." });
      }
      updateFields.description = description;
    }
    if (category !== undefined) {
      updateFields.category = category;
    }
    if (order !== undefined) {
      if (typeof order !== "number") {
        return res.status(400).json({ message: "Order must be a number." });
      }
      updateFields.order = order;
    }

    if (Object.keys(updateFields).length === 0) {
      return res
        .status(400)
        .json({ message: "No valid fields provided for update." });
    }

    updateFields.updatedAt = new Date();

    const result = await tasksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );
    if (result.modifiedCount === 0) {
      return res.status(400).json({ message: "No changes made to the task." });
    }

    const updatedTask = await tasksCollection.findOne({
      _id: new ObjectId(id),
    });
    io.emit("taskMoved", updatedTask);
    return res.status(200).json(updatedTask);
  } catch (error) {
    console.error("Error updating task:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// DELETE a task
app.delete("/tasks/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await tasksCollection.deleteOne({
      _id: new ObjectId(id),
      userId,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Task not found or not yours." });
    }

    io.emit("taskDeleted", id);
    return res.status(200).json({ message: "Task deleted successfully." });
  } catch (error) {
    console.error("Error deleting task:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// Optional reorder route
app.post("/tasks/reorderColumn", auth, async (req, res) => {
  return res.json({ message: "Implement reorder logic here" });
});

// Root
app.get("/", (req, res) => {
  res.send("Hello from ToDo Backend with real user data + JWT!");
});
