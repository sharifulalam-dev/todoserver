require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const morgan = require("morgan");

const port = process.env.PORT || 9000;
const app = express();

const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan("dev"));

// Use the proper port for MongoDB (default is 27017)
const uri = "mongodb://127.0.0.1:27017";

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Connect to MongoDB
async function initializeMongoDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB successfully!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}
initializeMongoDB();

// For testing, we use a fixed dummy user ID "test" in each endpoint

// Define database and collection references
const db = client.db("todolist");
const tasksCollection = db.collection("tasks");

// Create a new task
app.post("/tasks", async (req, res) => {
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

    const task = {
      title,
      description: description || "",
      category: category || "To-Do",
      userId: "test", // using a dummy user id
      createdAt: new Date(),
    };

    const result = await tasksCollection.insertOne(task);
    return res.status(201).json({ ...task, _id: result.insertedId });
  } catch (error) {
    console.error("Error creating task:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// Retrieve all tasks for the dummy user
app.get("/tasks", async (req, res) => {
  try {
    const tasks = await tasksCollection.find({ userId: "test" }).toArray();
    return res.status(200).json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// Update a task by ID
app.put("/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category } = req.body;
    const updateFields = {};

    if (title) {
      if (title.length > 50) {
        return res
          .status(400)
          .json({ message: "Title must be 50 characters or less." });
      }
      updateFields.title = title;
    }
    if (description) {
      if (description.length > 200) {
        return res
          .status(400)
          .json({ message: "Description must be 200 characters or less." });
      }
      updateFields.description = description;
    }
    if (category) {
      updateFields.category = category;
    }

    const result = await tasksCollection.updateOne(
      { _id: new ObjectId(id), userId: "test" },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Task not found." });
    }
    return res.status(200).json({ message: "Task updated successfully." });
  } catch (error) {
    console.error("Error updating task:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// Delete a task by ID
app.delete("/tasks/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await tasksCollection.deleteOne({
      _id: new ObjectId(id),
      userId: "test",
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Task not found." });
    }
    return res.status(200).json({ message: "Task deleted successfully." });
  } catch (error) {
    console.error("Error deleting task:", error);
    return res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
});

// A simple test route
app.get("/", (req, res) => {
  res.send("Hello from ToDo...");
});

app.listen(port, () => {
  console.log(`Todoapp running on port ${port}`);
});
