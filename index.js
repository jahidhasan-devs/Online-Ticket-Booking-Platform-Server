// const dns = require("node:dns");
// dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dontenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT;

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);


//Token verfication function
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  // ["Bearer", "xjasasdhsagdydsav"]

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Unauthorized" });
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

//Role ta vendor hole vendor ar ticket access korthe debe
const sellerVerify = async (req, res, next) => {
  const user = req.user;
  if (user.role !== "vendor" ) {
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

async function run() {
  try {
    await client.connect();
    const db = client.db("ticket-booking-platform");
    const subscriptionsCollection = db.collection("subscriptions");
    const userCollection = db.collection("user");
    const productCollection = db.collection("Tickets");
    const bookingCollection = db.collection("Bookings");
    const advertisedCollection = db.collection("AdvertisedTickets");

    //payment ar jonno
    app.post("/subscription", async (req, res) => {
      const { sessionId, userId, priceId } = req.body;

      const isExist = await subscriptionsCollection.findOne({ sessionId });
      if (isExist) {
        return res.json({ msg: "Already exist!" });
      }

      await subscriptionsCollection.insertOne({ sessionId, userId, priceId });

      //update user role
      await userCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { plan: "pro" } },
      );

      res.json({ msg: "Payment successfull!" });
    });

    // Ticket gula post kora hoy
    app.post("/vendor/tickets", verifyToken, sellerVerify, async (req, res) => {
      try {
        const data = req.body;

        // Vendor fraud kina check koro
        const vendor = await userCollection.findOne({
          email: req.user.email,
        });

        if (!vendor) {
          return res.status(404).send({ message: "Vendor not found" });
        }

        if (vendor.isFraud === true) {
          return res.status(403).send({
            message: `⚠️ Your vendor account has been restricted due to a policy violation.
               You cannot create new tickets. Please contact support if you believe this is a mistake.`,
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

    // 1. Admin: ticket Advertise করা
    app.post(
      "/admin/advertised-tickets/:ticketId",
      verifyToken,
      adminVerify,
      async (req, res) => {
        try {
          const { ticketId } = req.params;

          if (!ObjectId.isValid(ticketId)) {
            return res.status(400).json({
              message: "Invalid ticket ID",
            });
          }

          // Main Tickets collection থেকে ticket খুঁজবে
          const ticket = await productCollection.findOne({
            _id: new ObjectId(ticketId),
          });

          if (!ticket) {
            return res.status(404).json({
              message: "Ticket not found",
            });
          }

          // Ticket approved কি না যাচাই
          if (ticket.status !== "approved") {
            return res.status(400).json({
              message: "Only approved tickets can be advertised",
            });
          }

          // আগে থেকেই advertise করা আছে কি না
          const alreadyAdvertised = await advertisedCollection.findOne({
            ticketId: ticket._id,
          });

          if (alreadyAdvertised) {
            return res.status(400).json({
              message: "Ticket is already advertised",
            });
          }

          // সর্বোচ্চ ৬টি ticket advertise করা যাবে
          const totalAdvertised = await advertisedCollection.countDocuments();

          if (totalAdvertised >= 6) {
            return res.status(400).json({
              message: "Maximum 6 tickets can be advertised",
            });
          }

          // মূল ticket-এর তথ্য নতুন collection-এ save
          const { _id, ...ticketData } = ticket;

          await advertisedCollection.insertOne({
            ticketId: _id,
            ...ticketData,
            advertisedAt: new Date(),
          });

          return res.status(201).json({
            success: true,
            message: "Ticket advertised successfully",
          });
        } catch (error) {
          console.error("Advertise ticket error:", error);

          return res.status(500).json({
            message: "Failed to advertise ticket",
          });
        }
      },
    );

    // 2. Admin: ticket Unadvertise করা
    app.delete(
      "/admin/advertised-tickets/:ticketId",
      verifyToken,
      adminVerify,
      async (req, res) => {
        try {
          const { ticketId } = req.params;

          if (!ObjectId.isValid(ticketId)) {
            return res.status(400).json({
              message: "Invalid ticket ID",
            });
          }

          const result = await advertisedCollection.deleteOne({
            ticketId: new ObjectId(ticketId),
          });

          if (result.deletedCount === 0) {
            return res.status(404).json({
              message: "Advertised ticket not found",
            });
          }

          return res.status(200).json({
            success: true,
            message: "Ticket unadvertised successfully",
          });
        } catch (error) {
          console.error("Unadvertise ticket error:", error);

          return res.status(500).json({
            message: "Failed to unadvertise ticket",
          });
        }
      },
    );

    // 3. Homepage: advertised ticket পাওয়া
    app.get("/advertised-tickets", async (req, res) => {
      try {
        const tickets = await advertisedCollection
          .find({ status: "approved" })
          .sort({ advertisedAt: -1 })
          .limit(6)
          .toArray();

        res.send(tickets);
      } catch (error) {
        console.error("Get advertised tickets error:", error);

        res.status(500).json({
          message: "Failed to get advertised tickets",
        });
      }
    });

    // GET: সব user নিয়ে আসবে
    app.get("/admin/users", verifyToken, adminVerify, async (req, res) => {
      try {
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

        res.status(500).send({
          message: "Failed to fetch users",
        });
      }
    });
    // froud , admin and vendor changing
    app.patch(
      "/admin/users/:id/role",
      verifyToken,
      adminVerify,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { role } = req.body;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid user ID" });
          }

          const userId = new ObjectId(id);
          let updateData;

          if (role === "admin" || role === "vendor") {
            updateData = {
              role,
              updatedAt: new Date(),
            };
          } else if (role === "fraud") {
            const user = await userCollection.findOne({ _id: userId });

            if (!user) {
              return res.status(404).send({ message: "User not found" });
            }

            if (user.role !== "vendor") {
              return res.status(400).send({
                message: "Only vendors can be marked as fraud",
              });
            }

            updateData = {
              isFraud: true,
              updatedAt: new Date(),
            };
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

          res.send({
            success: true,
            message: "User updated successfully",
          });
        } catch (error) {
          console.error("User update error:", error);
          res.status(500).send({ message: "Failed to update user" });
        }
      },
    );

    //Admin page status approve jonno // seller verify add korce
    app.patch(
      "/admin/tickets/:id",
      verifyToken,
      adminVerify,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

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
          return res.status(404).send({
            message: "Pending ticket not found",
          });
        }

        res.send({ message: "Ticket status updated", result });
      },
    );

    //Booking collection
    app.post("/bookings", verifyToken, async (req, res) => {
      const data = req.body;

      const result = await bookingCollection.insertOne({
        ...data,
        userId: req.user.id,
      });

      res.send(result);
    });

    //pagination ar jonno
    app.get("/seller/products", verifyToken, sellerVerify, async (req, res) => {
      const { page = 1, limit = 10 } = req.query;
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

    // All products / tickets
    app.get("/products", async (req, res) => {
      try {
        const { search } = req.query;
        const query = {};

        // Search filter
        if (search && search !== "undefined") {
          query.$or = [
            { title: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } },
          ];
        }

        // Get fraud vendor IDs
        const fraudUsers = await userCollection
          .find({ role: "vendor", isFraud: true })
          .project({ _id: 1 })
          .toArray();

        const fraudUserIds = fraudUsers.map((user) => user._id.toString());

        // Hide fraud vendors' tickets
        if (fraudUserIds.length > 0) {
          query.userId = { $nin: fraudUserIds };
        }

        const result = await productCollection.find(query).toArray();

        res.send(result);
      } catch (error) {
        console.error("Fetch products error:", error);
        res.status(500).send({
          message: "Failed to fetch products",
        });
      }
    });

    //My- Tickets
    app.get("/vendor/my-tickets",
      verifyToken,
      sellerVerify,
      async (req, res) => {
        try {
          const tickets = await productCollection
            .find({ userId: req.user.id })
            .toArray();

          res.send(tickets);
        } catch (error) {
          console.error(error);
          res.status(500).send({
            message: "Failed to get tickets",
          });
        }
      },
    );

    // 1. একটি ticket-এর তথ্য আনা
    app.get("/vendor/my-tickets/:id",
      verifyToken,
      sellerVerify,
      async (req, res) => {
        try {
          const { id } = req.params;

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

    // 2. Ticket update করা
    app.patch("/vendor/my-tickets/:id",
      verifyToken,
      sellerVerify,
      async (req, res) => {
        try {
          const { id } = req.params;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid ticket ID" });
          }

          const filter = {
            _id: new ObjectId(id),
            userId: req.user.id,
          };

          const ticket = await productCollection.findOne(filter);

          if (!ticket) {
            return res.status(404).send({ message: "Ticket not found" });
          }

          if (ticket.status === "rejected") {
            return res.status(403).send({
              message: "Rejected tickets cannot be updated",
            });
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
            if (req.body[field] !== undefined) {
              updatedData[field] = req.body[field];
            }
          }

          if (
            !updatedData.title?.trim() ||
            !updatedData.fromLocation?.trim() ||
            !updatedData.toLocation?.trim() ||
            !updatedData.transportType ||
            updatedData.price === undefined ||
            updatedData.quantity === undefined
          ) {
            return res.status(400).send({
              message: "Please provide all required ticket fields",
            });
          }

          updatedData.price = Number(updatedData.price);
          updatedData.quantity = Number(updatedData.quantity);

          if (
            !Number.isFinite(updatedData.price) ||
            updatedData.price < 0 ||
            !Number.isInteger(updatedData.quantity) ||
            updatedData.quantity < 0
          ) {
            return res.status(400).send({
              message: "Invalid price or quantity",
            });
          }

          const result = await productCollection.updateOne(
            {
              ...filter,
              status: { $ne: "rejected" },
            },
            { $set: updatedData },
          );

          if (result.matchedCount === 0) {
            return res.status(403).send({
              message: "Ticket cannot be updated",
            });
          }

          res.send({
            success: true,
            message: "Ticket updated successfully",
          });
        } catch (error) {
          console.error("Update ticket error:", error);
          res.status(500).send({ message: "Failed to update ticket" });
        }
      },
    );

    // 3. Ticket delete করা
    app.delete( "/vendor/my-tickets/:id",
      verifyToken,
      sellerVerify,
      async (req, res) => {
        try {
          const { id } = req.params;

          if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid ticket ID" });
          }

          const filter = {
            _id: new ObjectId(id),
            userId: req.user.id,
          };

          const ticket = await productCollection.findOne(filter);

          if (!ticket) {
            return res.status(404).send({ message: "Ticket not found" });
          }

          if (ticket.status === "rejected") {
            return res.status(403).send({
              message: "Rejected tickets cannot be deleted",
            });
          }

          const result = await productCollection.deleteOne({
            ...filter,
            status: { $ne: "rejected" },
          });

          if (result.deletedCount === 0) {
            return res.status(403).send({
              message: "Ticket cannot be deleted",
            });
          }

          res.send({
            success: true,
            message: "Ticket deleted successfully",
          });
        } catch (error) {
          console.error("Delete ticket error:", error);
          res.status(500).send({ message: "Failed to delete ticket" });
        }
      },
    );

    //every ticket page by id
    app.get("/product/:id", async (req, res) => {
      const { id } = req.params;
      const result = await productCollection.findOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    //TODO: create payment data store api

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
