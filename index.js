require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);

const port = process.env.PORT || 9000;
const app = express();

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://test-982fe.web.app",
    "https://test-982fe.firebaseapp.com",
    "https://resplendent-melomakarona-35dde3.netlify.app",
  ],
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(morgan("dev"));
const username = process.env.MONGO_USERNAME;
const password = process.env.MONGO_PASSWORD;

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
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
}
initializeMongoDB();

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .send({ message: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(403).send({ message: "Invalid or expired token." });
  }
};

async function run() {
  try {
    const db = client.db("scholarship-portal");
    const usersCollection = db.collection("users");
    const scholarshipCollection = db.collection("scholarships");
    const appliedscholarshipCollection = db.collection("appliedscholarships");
    const reviewsCollection = db.collection("allreviews");
    const allFeedbackCollection = db.collection("allfeedback");

    const generateToken = (email) => {
      if (!process.env.ACCESS_TOKEN_SECRET) {
        throw new Error("JWT secret is not defined");
      }
      return jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1d",
      });
    };

    app.post("/generate-token", (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const token = generateToken(email);

      res.send({ token });
    });

    app.get("/allscholarship", async (req, res) => {
      const data = await scholarshipCollection.find().toArray();

      res.send(data);
    });

    app.patch("/allscholarship/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const filter = { _id: new ObjectId(id) };

      try {
        if (!Object.keys(updatedData).length) {
          return res
            .status(400)
            .json({ message: "No fields provided for update" });
        }

        const result = await scholarshipCollection.updateOne(filter, {
          $set: updatedData,
        });

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Scholarship not found" });
        }

        res.status(200).json({
          message: "Scholarship updated successfully",
          data: result,
        });
      } catch (error) {
        console.error("Error updating scholarship:", error.message);
        res.status(500).json({
          message: "Error updating scholarship",
          error: error.message,
        });
      }
    });

    app.delete("/allscholarship/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      try {
        const result = await scholarshipCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Scholarship not found" });
        }

        res.status(200).json({ message: "Scholarship deleted successfully" });
      } catch (error) {
        console.error("Error deleting scholarship:", error.message);
        res.status(500).json({
          message: "Error deleting scholarship",
          error: error.message,
        });
      }
    });

    app.get("/scholarship-details/:id", async (req, res) => {
      const id = req.params.id;
      const scholarship = await scholarshipCollection.findOne({
        _id: new ObjectId(id),
      });

      if (scholarship) {
        res.status(200).json(scholarship);
      } else {
        res.status(404).json({ error: "scholarship not found" });
      }
    });

    app.post("/add-feedback", async (req, res) => {
      try {
        // Extract data from the request body
        const { appliedScholarshipId, scholarshipId, feedback } = req.body;

        // Validate required fields
        if (!appliedScholarshipId || !scholarshipId || !feedback) {
          return res.status(400).json({
            message:
              "appliedScholarshipId, scholarshipId, and feedback are required.",
          });
        }

        // Prepare the feedback document
        const feedbackDocument = {
          appliedScholarshipId: new ObjectId(appliedScholarshipId), // Convert to ObjectId
          scholarshipId: new ObjectId(scholarshipId), // Convert to ObjectId
          feedback,
          date: Date.now(), // Add the current date
        };

        // Insert the feedback into the database
        const result = await allFeedbackCollection.insertOne(feedbackDocument);

        // Respond with success message
        res.status(201).json({
          message: "Feedback added successfully!",
          feedbackId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding feedback:", error);
        res.status(500).json({
          message: "An error occurred while adding feedback.",
        });
      }
    });

    app.post("/add-user", async (req, res) => {
      const { email, name, photoURL } = req.body;

      if (!email || !name) {
        return res.status(400).send({ message: "Email and name are required" });
      }

      try {
        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          return res
            .status(200)
            .send({ message: "User already exists", userId: existingUser._id });
        }

        const newUser = {
          email,
          name,
          photoURL,
          role: "user",
          createdAt: Date.now(),
        };
        const result = await usersCollection.insertOne(newUser);

        res.status(201).send({
          message: "User added successfully",
          userId: result.insertedId,
        });
      } catch (error) {
        console.error("Error adding user:", error);
        res.status(500).send({ message: "Internal server error" });
      }
    });

    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const { amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount * 100,
          currency: "usd",
          automatic_payment_methods: { enabled: true },
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).send({ message: "Payment creation failed" });
      }
    });

    app.post("/confirm-payment", verifyToken, async (req, res) => {
      const { paymentIntentId, amount } = req.body;

      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          paymentIntentId
        );

        if (paymentIntent.status === "succeeded") {
          const paymentDetails = {
            paymentIntentId,
            amount,
            timestamp: Date.now(),
          };

          res.send({
            success: true,
            message: "Payment successful",
            paymentDetails,
          });
        } else {
          res
            .status(400)
            .send({ success: false, message: "Payment not completed" });
        }
      } catch (error) {
        console.error("Error confirming payment:", error);
        res
          .status(500)
          .send({ success: false, message: "Payment confirmation failed" });
      }
    });

    app.get("/payment/:id", async (req, res) => {
      const id = req.params.id;
      const scholarship = await scholarshipCollection.findOne({
        _id: new ObjectId(id),
      });

      if (scholarship) {
        res.status(200).json(scholarship);
      } else {
        res.status(404).json({ error: "scholarship not found" });
      }
    });

    app.post("/appliedscholarships", async (req, res) => {
      const { scholarshipId, universityCity, universityCountry, email } =
        req.body;

      try {
        const user = await usersCollection.findOne(
          { email },
          { projection: { _id: 1, name: 1, email: 1 } }
        );

        if (!user) {
          return res.status(404).json({ message: "User not found." });
        }

        const { _id: userId, name } = user;

        const applicationData = {
          ...req.body,
          userId,
          username: name,
          status: "Pending",
          currentDate: new Date(),
        };

        const result = await appliedscholarshipCollection.insertOne(
          applicationData
        );

        if (result.acknowledged) {
          res.status(201).json({
            message: "Application submitted successfully!",
            insertedId: result.insertedId,
          });
        } else {
          console.error("Failed to insert application data.");
          res
            .status(500)
            .json({ message: "Failed to submit the application." });
        }
      } catch (error) {
        console.error("Error inserting document:", error);
        res.status(500).json({
          message: "An error occurred while submitting the application.",
        });
      }
    });

    app.get("/appliedscholarships", async (req, res) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      try {
        const matchedScholarships = await appliedscholarshipCollection
          .find({ email })
          .toArray();

        if (matchedScholarships.length === 0) {
          return res
            .status(404)
            .json({ error: "No scholarships found for the given email" });
        }

        res.status(200).json(matchedScholarships);
      } catch (error) {
        console.error("Error fetching scholarships:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.delete("/appliedscholarships/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid ID provided." });
      }

      try {
        const result = await appliedscholarshipCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Scholarship not found." });
        }

        res.send({ message: "Scholarship deleted successfully." });
      } catch (error) {
        console.error("Error deleting scholarship:", error);
        res.status(500).send({ message: "Internal server error." });
      }
    });

    app.post("/addreviews", async (req, res) => {
      const {
        scholarshipId,
        rating,
        comment,
        date,
        email,
        reviwerImage,
        reviewerName,
      } = req.body;

      try {
        if (!ObjectId.isValid(scholarshipId)) {
          console.error("Invalid scholarshipId provided:", scholarshipId);
          return res.status(400).send({ message: "Invalid scholarship ID." });
        }

        const objectId = new ObjectId(scholarshipId);

        const scholarshipData = await scholarshipCollection
          .aggregate([
            {
              $match: { _id: objectId },
            },
            {
              $project: {
                subjectCategory: "$subjectCategory",
                universityName: "$universityName",
                scholarshipName: "$scholarshipName",
              },
            },
          ])
          .toArray();

        "Aggregation Result:", scholarshipData;

        if (!scholarshipData || scholarshipData.length === 0) {
          console.error("No matching scholarship found for ID:", scholarshipId);
          return res.status(404).send({ message: "Scholarship not found." });
        }

        const { scholarshipName, subjectCategory, universityName } =
          scholarshipData[0];

        const review = {
          scholarshipName,
          universityName,
          subjectCategory,
          rating,
          comment,
          date,
          email,
          reviwerImage,
          reviewerName,
        };

        const result = await reviewsCollection.insertOne(review);

        res.status(201).send({
          message: "Review added successfully!",
          reviewId: result.insertedId,
        });
      } catch (error) {
        console.error("Error during review submission:", error);
        res.status(500).send({ message: "Failed to add review." });
      }
    });

    app.get("/allappliedscholarships", async (req, res) => {
      try {
        const appliedScholarshipData = await appliedscholarshipCollection
          .find()
          .toArray();

        if (appliedScholarshipData.length === 0) {
          return res.status(200).json({ message: "No scholarship found." });
        }

        res.status(200).json(appliedScholarshipData);
      } catch (error) {
        console.error("Error fetching all reviews:", error.message);
        res.status(500).json({ message: "Failed to fetch scholarships." });
      }
    });

    app.patch("/allappliedscholarships/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const filter = { _id: new ObjectId(id) };

      updateDoc = {
        $set: { status: status },
      };
      const result = await appliedscholarshipCollection.updateOne(
        filter,
        updateDoc
      );
      res.send(result);
    });

    app.get("/allreviews", async (req, res) => {
      try {
        const reviews = await reviewsCollection.find().toArray();

        if (reviews.length === 0) {
          return res.status(200).json({ message: "No reviews found." });
        }

        res.status(200).json(reviews);
      } catch (error) {
        console.error("Error fetching all reviews:", error.message);
        res.status(500).json({ message: "Failed to fetch reviews." });
      }
    });

    app.delete("/allreviews/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await reviewsCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/reviews", async (req, res) => {
      const { email } = req.query;

      try {
        if (!email) {
          return res.status(400).json({ message: "Email is required." });
        }

        const reviews = await reviewsCollection.find({ email }).toArray();

        if (reviews.length === 0) {
          return res
            .status(404)
            .json({ message: "No reviews found for this email." });
        }

        res.status(200).json(reviews);
      } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({ message: "Failed to fetch reviews." });
      }
    });

    app.delete("/reviews/:id", async (req, res) => {
      const { id } = req.params;

      try {
        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Review not found." });
        }

        res.status(200).json({ message: "Review deleted successfully." });
      } catch (error) {
        console.error("Error deleting review:", error);
        res.status(500).json({ message: "Internal server error." });
      }
    });

    app.patch("/reviews/:id", async (req, res) => {
      const { id } = req.params;
      const { comment, date } = req.body;

      if (!comment || !date) {
        return res
          .status(400)
          .json({ message: "Comment and date are required." });
      }

      try {
        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { comment, date } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Review not found." });
        }

        res.status(200).json({ message: "Review updated successfully." });
      } catch (error) {
        console.error("Error updating review:", error);
        res.status(500).json({ message: "Internal server error." });
      }
    });

    app.post("/addscholarship", async (req, res) => {
      const {
        scholarshipName,
        universityName,
        universityImage,
        universityCountry,
        universityCity,
        universityRank,
        subjectName,
        subjectCategory,
        scholarshipCategory,
        degree,
        tuitionFees,
        applicationFees,
        serviceCharge,
        applicationDeadline,
        postDate,
        scholarshipDescription,
        stipend,
        rating,
        postedUserEmail,
      } = req.body;

      if (
        !scholarshipName ||
        !universityName ||
        !universityImage ||
        !universityCountry ||
        !universityCity ||
        !subjectCategory ||
        !scholarshipCategory ||
        !degree ||
        !applicationDeadline
      ) {
        return res.status(400).json({ message: "Missing required fields." });
      }

      if (rating && (rating < 1 || rating > 5)) {
        return res
          .status(400)
          .json({ message: "Rating must be between 1 and 5." });
      }

      const newScholarship = {
        scholarshipName,
        universityName,
        universityImage,
        universityCountry,
        universityCity,
        universityRank: universityRank ? parseInt(universityRank) : null, // Parse as integer
        subjectName,
        subjectCategory,
        scholarshipCategory,
        degree,
        tuitionFees: tuitionFees ? parseFloat(tuitionFees) : null,
        applicationFees: applicationFees ? parseFloat(applicationFees) : null,
        serviceCharge: serviceCharge ? parseFloat(serviceCharge) : null,
        applicationDeadline,
        postDate: postDate || new Date().toISOString().split("T")[0],
        scholarshipDescription,
        stipend: stipend ? parseFloat(stipend) : null,
        rating: rating ? parseFloat(rating) : null,
        postedUserEmail,
      };

      try {
        const result = await scholarshipCollection.insertOne(newScholarship);

        if (result.acknowledged) {
          res.status(200).json({
            message: "Scholarship added successfully!",
            id: result.insertedId,
          });
        } else {
          res.status(500).json({ message: "Failed to add scholarship." });
        }
      } catch (error) {
        console.error("Error adding scholarship:", error);
        res.status(500).json({ message: "An internal server error occurred." });
      }
    });

    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.status(200).json(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    });

    app.patch("/users/:id", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      if (!["user", "moderator", "admin"].includes(role)) {
        return res.status(400).json({ message: "Invalid role specified" });
      }

      try {
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json({ message: `User role updated to ${role}` });
      } catch (error) {
        console.error("Error updating user role:", error);
        res.status(500).json({ message: "Failed to update user role" });
      }
    });

    app.delete("/users/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      try {
        const result = await usersCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json({ message: "User deleted successfully" });
      } catch (error) {
        console.error("Error deleting user:", error);
        res.status(500).json({ message: "Failed to delete user" });
      }
    });

    app.get("/users/:email", async (req, res) => {
      const { email } = req.params;
      try {
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.status(200).json(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ message: "Failed to fetch user" });
      }
    });
  } finally {
  }
}

run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Scholarship...");
});

app.listen(port, () => {
  console.log(`Scholarship Server is running on port ${port}`);
});
