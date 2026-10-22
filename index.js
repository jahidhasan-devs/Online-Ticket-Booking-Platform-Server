// const dns = require("node:dns");
// dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI;

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  process.env.NEXT_PUBLIC_CLIENT_URL,
].filter(Boolean);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
  }),
);
app.use(express.json());

const client = new MongoClient(mongoUri || "mongodb://127.0.0.1:27017/test", {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let database = null;
let databaseReadyPromise = null;

const getDatabase = async () => {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not configured");
  }

  if (!databaseReadyPromise) {
    databaseReadyPromise = client.connect().then(() => {
      database = client.db("ticket-booking-platform");
      return database;
    });
  }

  return databaseReadyPromise;
};

const getCollections = async () => {
  const db = await getDatabase();

  return {
    subscriptionsCollection: db.collection("subscriptions"),
    paymentCollection: db.collection("payments"),
    userCollection: db.collection("user"),
    productCollection: db.collection("Tickets"),
    bookingCollection: db.collection("Bookings"),
    advertisedCollection: db.collection("AdvertisedTickets"),
  };
};

const JWKS = process.env.CLIENT_URL
  ? createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`))
  : null;

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  if (!JWKS) {
    return res
      .status(503)
      .json({ msg: "Authentication configuration missing" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.log(error);
    return res.status(401).json({ msg: "Unauthorized" });
  }
};

const sellerVerify = async (req, res, next) => {
  const user = req.user;
  if (user?.role !== "vendor") {
    return res.status(403).json({ msg: "Forbidden" });
  }
  next();
};

const adminVerify = async (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).send({
      message: "Only admin can perform this action",
      role: req.user?.role,
    });
  }

  next();
};

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.get("/healthz", async (req, res) => {
  try {
    await getDatabase();
    res.status(200).json({
      ok: true,
      message: "Server and database connection are ready",
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      message: "Database connection failed",
      error: error.message,
    });
  }
});

app.post("/subscription", async (req, res) => {
  try {
    const { sessionId, userId, priceId } = req.body;
    const { subscriptionsCollection, userCollection } = await getCollections();

    const isExist = await subscriptionsCollection.findOne({ sessionId });
    if (isExist) {
      return res.json({ msg: "Already exist!" });
    }

    await subscriptionsCollection.insertOne({ sessionId, userId, priceId });

    await userCollection.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { plan: "pro" } },
    );

    res.json({ msg: "Payment successfull!" });
  } catch (error) {
    console.error("Subscription error:", error);
    res.status(500).json({ message: "Failed to process subscription" });
  }
});

app.post("/payment", async (req, res) => {
  try {
    const paymentData = req.body;
    const { paymentCollection, bookingCollection } = await getCollections();

    const paymentRecord = {
      ...paymentData,
      createdAt: new Date(),
    };

    const insertResult = await paymentCollection.insertOne(paymentRecord);

    if (paymentData.bookingId) {
      let filter;
      try {
        filter = { _id: new ObjectId(paymentData.bookingId) };
      } catch {
        filter = { _id: paymentData.bookingId };
      }

      await bookingCollection.updateOne(filter, {
        $set: {
          status: "paid",
          paymentStatus: "paid",
          transactionId:
            paymentData.transactionId || paymentData.session_id || "",
          paidAt: new Date(),
        },
      });
    }

    res.status(201).send({
      success: true,
      message: "Payment recorded successfully",
      insertedId: insertResult.insertedId,
    });
  } catch (error) {
    console.error("Error saving payment:", error);
    res.status(500).send({
      success: false,
      message: "Failed to record payment",
      error: error.message,
    });
  }
});

app.get("/payment", async (req, res) => {
  try {
    const email = req.query.email;
    const { paymentCollection } = await getCollections();
    let query = {};

    if (email) {
      query = {
        $or: [
          { userEmail: email },
          { customer_email: email },
          { email: email },
        ],
      };
    }

    const payments = await paymentCollection
      .find(query)
      .sort({ createdAt: -1, _id: -1 })
      .toArray();

    res.status(200).send(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).send({
      success: false,
      message: "Failed to fetch payments",
      error: error.message,
    });
  }
});

app.get(
  "/vendor/revenue-stats",
  verifyToken,
  sellerVerify,
  async (req, res) => {
    try {
      const { paymentCollection } = await getCollections();
      const paidPayments = await paymentCollection
        .find({
          $or: [
            { ticketTitle: { $exists: true, $ne: "" } },
            { title: { $exists: true, $ne: "" } },
          ],
        })
        .sort({ createdAt: -1, _id: -1 })
        .toArray();

      const now = new Date();
      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      let totalRevenue = 0;
      let todayRevenue = 0;
      let monthRevenue = 0;

      paidPayments.forEach((payment) => {
        const amount = Number(payment.amount || payment.price || 0);
        const paymentDate = new Date(
          payment.createdAt || payment.paymentDate || Date.now(),
        );

        totalRevenue += amount;
        if (paymentDate >= startOfToday) todayRevenue += amount;
        if (paymentDate >= startOfMonth) monthRevenue += amount;
      });

      res.status(200).send({
        success: true,
        data: {
          totalRevenue,
          todayRevenue,
          monthRevenue,
          totalBookings: paidPayments.length,
          recentTransactions: paidPayments.slice(0, 10),
        },
      });
    } catch (error) {
      console.error("Error fetching vendor revenue:", error);
      res.status(500).send({
        success: false,
        message: "Server error fetching revenue data",
        error: error.message,
      });
    }
  },
);

app.post("/vendor/tickets", verifyToken, sellerVerify, async (req, res) => {
  try {
    const data = req.body;
    const { userCollection, productCollection } = await getCollections();

    const vendor = await userCollection.findOne({ email: req.user.email });
    if (!vendor) {
      return res.status(404).send({ message: "Vendor not found" });
    }

    if (vendor.isFraud === true) {
      return res.status(403).send({
        message:
          "⚠️ Your vendor account has been restricted due to a policy violation. You cannot create new tickets. Please contact support if you believe this is a mistake.",
      });
    }

    const result = await productCollection.insertOne({
      ...data,
      userId: req.user.id,
    });

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to add ticket" });
  }
});

app.post(
  "/admin/advertised-tickets/:ticketId",
  verifyToken,
  adminVerify,
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { productCollection, advertisedCollection } =
        await getCollections();

      if (!ObjectId.isValid(ticketId)) {
        return res.status(400).json({ message: "Invalid ticket ID" });
      }

      const ticket = await productCollection.findOne({
        _id: new ObjectId(ticketId),
      });

      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" });
      }

      if (ticket.status !== "approved") {
        return res
          .status(400)
          .json({ message: "Only approved tickets can be advertised" });
      }

      const alreadyAdvertised = await advertisedCollection.findOne({
        ticketId: ticket._id,
      });
      if (alreadyAdvertised) {
        return res
          .status(400)
          .json({ message: "Ticket is already advertised" });
      }

      const totalAdvertised = await advertisedCollection.countDocuments();
      if (totalAdvertised >= 6) {
        return res
          .status(400)
          .json({ message: "Maximum 6 tickets can be advertised" });
      }

      const { _id, ...ticketData } = ticket;
      await advertisedCollection.insertOne({
        ticketId: _id,
        ...ticketData,
        advertisedAt: new Date(),
      });

      return res
        .status(201)
        .json({ success: true, message: "Ticket advertised successfully" });
    } catch (error) {
      console.error("Advertise ticket error:", error);
      return res.status(500).json({ message: "Failed to advertise ticket" });
    }
  },
);

app.delete(
  "/admin/advertised-tickets/:ticketId",
  verifyToken,
  adminVerify,
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { advertisedCollection } = await getCollections();

      if (!ObjectId.isValid(ticketId)) {
        return res.status(400).json({ message: "Invalid ticket ID" });
      }

      const result = await advertisedCollection.deleteOne({
        ticketId: new ObjectId(ticketId),
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: "Advertised ticket not found" });
      }

      return res
        .status(200)
        .json({ success: true, message: "Ticket unadvertised successfully" });
    } catch (error) {
      console.error("Unadvertise ticket error:", error);
      return res.status(500).json({ message: "Failed to unadvertise ticket" });
    }
  },
);

app.get("/advertised-tickets", async (req, res) => {
  try {
    const { advertisedCollection } = await getCollections();
    const tickets = await advertisedCollection
      .find({ status: "approved" })
      .sort({ advertisedAt: -1 })
      .limit(6)
      .toArray();

    res.send(tickets);
  } catch (error) {
    console.error("Get advertised tickets error:", error);
    res.status(500).json({ message: "Failed to get advertised tickets" });
  }
});

app.get("/admin/users", verifyToken, adminVerify, async (req, res) => {
  try {
    const { userCollection } = await getCollections();
    const users = await userCollection
      .find(
        {},
        {
          projection: {
            name: 1,
            email: 1,
            role: 1,
            isFraud: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();

    res.send(users);
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).send({ message: "Failed to fetch users" });
  }
});

app.patch(
  "/admin/users/:id/role",
  verifyToken,
  adminVerify,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      const { userCollection } = await getCollections();

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid user ID" });
      }

      const userId = new ObjectId(id);
      let updateData;

      if (role === "admin" || role === "vendor") {
        updateData = { role, updatedAt: new Date() };
      } else if (role === "fraud") {
        const user = await userCollection.findOne({ _id: userId });
        if (!user) return res.status(404).send({ message: "User not found" });
        if (user.role !== "vendor") {
          return res
            .status(400)
            .send({ message: "Only vendors can be marked as fraud" });
        }
        updateData = { isFraud: true, updatedAt: new Date() };
      } else {
        return res.status(400).send({ message: "Invalid role" });
      }

      const result = await userCollection.updateOne(
        { _id: userId },
        { $set: updateData },
      );

      if (result.matchedCount === 0) {
        return res.status(404).send({ message: "User not found" });
      }

      res.send({ success: true, message: "User updated successfully" });
    } catch (error) {
      console.error("User update error:", error);
      res.status(500).send({ message: "Failed to update user" });
    }
  },
);

app.patch("/admin/tickets/:id", verifyToken, adminVerify, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const { productCollection } = await getCollections();

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid ticket ID" });
  }

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).send({ message: "Invalid status" });
  }

  const result = await productCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status } },
  );

  if (result.matchedCount === 0) {
    return res.status(404).send({ message: "Pending ticket not found" });
  }

  res.send({ message: "Ticket status updated", result });
});

app.post("/bookings", verifyToken, async (req, res) => {
  const data = req.body;
  const { bookingCollection } = await getCollections();

  const result = await bookingCollection.insertOne({
    ...data,
    userId: req.user.id,
  });

  res.send(result);
});

app.get("/seller/products", verifyToken, sellerVerify, async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const { productCollection } = await getCollections();
  const skip = (Number(page) - 1) * Number(limit);

  const result = await productCollection
    .find({ userId: req.user.id })
    .skip(skip)
    .limit(Number(limit))
    .toArray();

  const totalData = await productCollection.countDocuments({
    userId: req.user.id,
  });
  const totalPage = Math.ceil(totalData / Number(limit));

  res.send({ data: result, page: Number(page), totalPage });
});

app.get("/admin/all-tickets", async (req, res) => {
  try {
    const { productCollection } = await getCollections();
    const tickets = await productCollection
      .find({})
      .sort({ _id: -1 })
      .toArray();
    res.send(tickets);
  } catch (error) {
    console.error("Admin tickets fetch error:", error);
    res.status(500).send({ message: "Failed to fetch admin tickets" });
  }
});

app.get("/products", async (req, res) => {
  try {
    const { userCollection, productCollection } = await getCollections();
    const {
      search,
      from,
      to,
      transportType,
      sort,
      status,
      page = 1,
      limit = 8,
    } = req.query;

    const andConditions = [];

    if (status && status !== "undefined" && status.trim() !== "") {
      andConditions.push({ status: status.trim() });
    }

    if (search && search !== "undefined" && search.trim() !== "") {
      const searchRegex = new RegExp(search.trim(), "i");
      andConditions.push({
        $or: [
          { title: { $regex: searchRegex } },
          { description: { $regex: searchRegex } },
          { vendorName: { $regex: searchRegex } },
        ],
      });
    }

    if (from && from !== "undefined" && from.trim() !== "") {
      andConditions.push({
        fromLocation: { $regex: new RegExp(from.trim(), "i") },
      });
    }

    if (to && to !== "undefined" && to.trim() !== "") {
      andConditions.push({
        toLocation: { $regex: new RegExp(to.trim(), "i") },
      });
    }

    if (
      transportType &&
      transportType !== "all" &&
      transportType !== "undefined" &&
      transportType.trim() !== ""
    ) {
      andConditions.push({
        transportType: { $regex: new RegExp(`^${transportType.trim()}$`, "i") },
      });
    }

    const fraudUsers = await userCollection
      .find({ role: "vendor", isFraud: true })
      .project({ _id: 1 })
      .toArray();
    const fraudUserIds = fraudUsers.map((user) => user._id.toString());
    if (fraudUserIds.length > 0) {
      andConditions.push({ userId: { $nin: fraudUserIds } });
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};
    let sortOptions = {};

    if (sort === "lowToHigh") sortOptions.price = 1;
    else if (sort === "highToLow") sortOptions.price = -1;
    else sortOptions._id = -1;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 8;
    const skip = (pageNum - 1) * limitNum;

    const totalTickets = await productCollection.countDocuments(query);
    const totalPages = Math.ceil(totalTickets / limitNum) || 1;

    const tickets = await productCollection
      .find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .toArray();

    res.send({ tickets, totalTickets, totalPages, currentPage: pageNum });
  } catch (error) {
    console.error("Fetch products error:", error);
    res.status(500).send({ message: "Failed to fetch products" });
  }
});

app.get("/vendor/my-tickets", verifyToken, sellerVerify, async (req, res) => {
  try {
    const { productCollection } = await getCollections();
    const tickets = await productCollection
      .find({ userId: req.user.id })
      .toArray();
    res.send(tickets);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to get tickets" });
  }
});

app.get(
  "/vendor/my-tickets/:id",
  verifyToken,
  sellerVerify,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { productCollection } = await getCollections();

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid ticket ID" });
      }

      const ticket = await productCollection.findOne({
        _id: new ObjectId(id),
        userId: req.user.id,
      });

      if (!ticket) {
        return res.status(404).send({ message: "Ticket not found" });
      }

      res.send(ticket);
    } catch (error) {
      console.error("Get ticket error:", error);
      res.status(500).send({ message: "Failed to get ticket" });
    }
  },
);

app.patch(
  "/vendor/my-tickets/:id",
  verifyToken,
  sellerVerify,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { productCollection } = await getCollections();

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid ticket ID" });
      }

      const filter = { _id: new ObjectId(id), userId: req.user.id };
      const ticket = await productCollection.findOne(filter);

      if (!ticket) {
        return res.status(404).send({ message: "Ticket not found" });
      }

      if (ticket.status === "rejected") {
        return res
          .status(403)
          .send({ message: "Rejected tickets cannot be updated" });
      }

      const allowedFields = [
        "title",
        "fromLocation",
        "toLocation",
        "transportType",
        "price",
        "quantity",
        "image",
      ];

      const updatedData = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) updatedData[field] = req.body[field];
      }

      if (
        !updatedData.title?.trim() ||
        !updatedData.fromLocation?.trim() ||
        !updatedData.toLocation?.trim() ||
        !updatedData.transportType ||
        updatedData.price === undefined ||
        updatedData.quantity === undefined
      ) {
        return res
          .status(400)
          .send({ message: "Please provide all required ticket fields" });
      }

      updatedData.price = Number(updatedData.price);
      updatedData.quantity = Number(updatedData.quantity);

      if (
        !Number.isFinite(updatedData.price) ||
        updatedData.price < 0 ||
        !Number.isInteger(updatedData.quantity) ||
        updatedData.quantity < 0
      ) {
        return res.status(400).send({ message: "Invalid price or quantity" });
      }

      const result = await productCollection.updateOne(
        { ...filter, status: { $ne: "rejected" } },
        { $set: updatedData },
      );

      if (result.matchedCount === 0) {
        return res.status(403).send({ message: "Ticket cannot be updated" });
      }

      res.send({ success: true, message: "Ticket updated successfully" });
    } catch (error) {
      console.error("Update ticket error:", error);
      res.status(500).send({ message: "Failed to update ticket" });
    }
  },
);

app.delete(
  "/vendor/my-tickets/:id",
  verifyToken,
  sellerVerify,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { productCollection } = await getCollections();

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid ticket ID" });
      }

      const filter = { _id: new ObjectId(id), userId: req.user.id };
      const ticket = await productCollection.findOne(filter);

      if (!ticket) {
        return res.status(404).send({ message: "Ticket not found" });
      }

      if (ticket.status === "rejected") {
        return res
          .status(403)
          .send({ message: "Rejected tickets cannot be deleted" });
      }

      const result = await productCollection.deleteOne({
        ...filter,
        status: { $ne: "rejected" },
      });

      if (result.deletedCount === 0) {
        return res.status(403).send({ message: "Ticket cannot be deleted" });
      }

      res.send({ success: true, message: "Ticket deleted successfully" });
    } catch (error) {
      console.error("Delete ticket error:", error);
      res.status(500).send({ message: "Failed to delete ticket" });
    }
  },
);

app.get("/product/:id", async (req, res) => {
  const { id } = req.params;
  const { productCollection } = await getCollections();
  const result = await productCollection.findOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.get("/vendor/requested-bookings", verifyToken, async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { productCollection, bookingCollection, userCollection } =
      await getCollections();

    const vendorTickets = await productCollection
      .find({ userId: vendorId })
      .project({ _id: 1, title: 1, price: 1 })
      .toArray();

    const ticketIds = vendorTickets.map((ticket) => ticket._id.toString());
    if (ticketIds.length === 0) return res.send([]);

    const bookings = await bookingCollection
      .find({ ticketId: { $in: ticketIds }, status: "Pending" })
      .toArray();

    const result = await Promise.all(
      bookings.map(async (booking) => {
        const ticket = vendorTickets.find(
          (t) => t._id.toString() === booking.ticketId,
        );
        const user = await userCollection.findOne(
          { _id: new ObjectId(booking.userId) },
          { projection: { name: 1, email: 1 } },
        );

        return {
          _id: booking._id,
          quantity: booking.quantity,
          status: booking.status,
          ticketTitle: ticket?.title || "Unknown",
          unitPrice: ticket?.price || 0,
          totalPrice: (ticket?.price || 0) * booking.quantity,
          userName: user?.name || "Unknown",
          userEmail: user?.email || "Unknown",
        };
      }),
    );

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to get requested bookings" });
  }
});

app.patch("/bookings/:id/accept", verifyToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const vendorId = req.user.id;
    const { productCollection, bookingCollection } = await getCollections();

    const booking = await bookingCollection.findOne({
      _id: new ObjectId(bookingId),
    });
    if (!booking) return res.status(404).send({ message: "Booking not found" });

    const ticket = await productCollection.findOne({
      _id: new ObjectId(booking.ticketId),
      userId: vendorId,
    });

    if (!ticket) return res.status(403).send({ message: "Unauthorized" });

    const result = await bookingCollection.updateOne(
      { _id: new ObjectId(bookingId) },
      { $set: { status: "accepted" } },
    );

    res.send({
      success: true,
      message: "Booking accepted successfully",
      result,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to accept booking" });
  }
});

app.patch("/bookings/:id/reject", verifyToken, async (req, res) => {
  try {
    const bookingId = req.params.id;
    const vendorId = req.user.id;
    const { productCollection, bookingCollection } = await getCollections();

    const booking = await bookingCollection.findOne({
      _id: new ObjectId(bookingId),
    });
    if (!booking) return res.status(404).send({ message: "Booking not found" });

    const ticket = await productCollection.findOne({
      _id: new ObjectId(booking.ticketId),
      userId: vendorId,
    });

    if (!ticket) return res.status(403).send({ message: "Unauthorized" });

    const result = await bookingCollection.updateOne(
      { _id: new ObjectId(bookingId) },
      { $set: { status: "rejected" } },
    );

    res.send({
      success: true,
      message: "Booking rejected successfully",
      result,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to reject booking" });
  }
});

app.get("/user/my-bookings", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingCollection, productCollection } = await getCollections();

    const bookings = await bookingCollection
      .find({ userId })
      .sort({ _id: -1 })
      .toArray();
    if (bookings.length === 0) return res.send([]);

    const result = await Promise.all(
      bookings.map(async (booking) => {
        const ticket = await productCollection.findOne({
          _id: new ObjectId(booking.ticketId),
        });

        return {
          _id: booking._id,
          quantity: booking.quantity,
          status: booking.status,
          ticketTitle: ticket?.title || "Unknown Ticket",
          ticketImage: ticket?.image || "",
          fromLocation: ticket?.fromLocation || "",
          toLocation: ticket?.toLocation || "",
          departureDateTime: ticket?.departureDateTime || "",
          unitPrice: ticket?.price || 0,
          totalPrice: (ticket?.price || 0) * booking.quantity,
        };
      }),
    );

    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to get my bookings" });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
