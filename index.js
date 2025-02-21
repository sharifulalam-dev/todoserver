require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const morgan = require("morgan");
const http = require("http");
const { Server } = require("socket.io");

const port = process.env.PORT || 9000;
const app = express();

const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan("dev"));

// MongoDB connection URI
const uri = `mongodb+srv://${username}:${password}@cluster0.lhbmo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function initializeMongoDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB successfully!");

    // Create indexes for the unified tasks collection
    const db = client.db("todolist");
    const tasksCollection = db.collection("tasks");
    await tasksCollection.createIndexes([
      { key: { category: 1, order: 1 } },
      { key: { userId: 1 } },
    ]);
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}

initializeMongoDB();

// Dummy User ID (for simplicity, this can be replaced with real user management)
const dummyUserId = "test";

// Unified tasks collection reference
const db = client.db("todolist");
const tasksCollection = db.collection("tasks");

// Create HTTP server and attach Socket.io
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://todo-1dd5f.web.app",
      "https://todo-1dd5f.firebaseapp.com",
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ----- API Endpoints ----- //

// Create a new task
app.post("/tasks", async (req, res) => {
  try {
    let { title, description, category } = req.body;
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
    category = category || "To-Do";
    const tasksCollection = db.collection("tasks");

    // Calculate order: find the highest order value in this category
    const maxOrderDoc = await tasksCollection
      .find({ userId: dummyUserId, category })
      .sort({ order: -1 })
      .limit(1)
      .toArray();
    const order = maxOrderDoc.length > 0 ? (maxOrderDoc[0].order || 0) + 1 : 0;

    const task = {
      title,
      description: description || "",
      category,
      order,
      userId: dummyUserId,
      createdAt: new Date(),
    };
    const result = await tasksCollection.insertOne(task);
    const newTask = { ...task, _id: result.insertedId };
    io.emit("taskCreated", newTask);
    return res.status(201).json(newTask);
  } catch (error) {
    console.error("Error creating task:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// Get all tasks (sorted by order)
app.get("/tasks", async (req, res) => {
  try {
    const tasks = await tasksCollection
      .find({ userId: dummyUserId })
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

app.put("/tasks/:id", async (req, res) => {
  try {
    const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
    console.log(task);
    const { id } = req.params;
    const { category: newCategory, order: newOrder } = req.body;

    // Validate the new category and order
    if (!newCategory || typeof newOrder !== "number") {
      return res.status(400).json({ message: "Invalid category or order." });
    }

    // Find the original task
    const originalTask = await tasksCollection.findOne({
      _id: new ObjectId(id),
      userId: dummyUserId,
    });

    if (!originalTask) {
      return res.status(404).json({ message: "Task not found." });
    }

    // Update the task's category and order
    const updateFields = {
      category: newCategory,
      order: newOrder,
      updatedAt: new Date(),
    };

    const result = await tasksCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateFields }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({ message: "No changes made to the task." });
    }

    // Fetch the updated task
    const updatedTask = await tasksCollection.findOne({
      _id: new ObjectId(id),
    });

    // Emit the task update to all connected clients
    io.emit("taskMoved", updatedTask);

    return res.status(200).json(updatedTask);
  } catch (error) {
    console.error("Error updating task:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// Delete a task
app.delete("/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await tasksCollection.deleteOne({
      _id: new ObjectId(id),
      userId: dummyUserId,
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Task not found." });
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

app.get("/", (req, res) => {
  res.send("Hello from ToDo Backend...");
});

// Start the server
httpServer.listen(port, () => {
  console.log(`Todoapp running on port ${port}`);
});
