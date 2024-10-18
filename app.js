import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { Server } from "socket.io";
import http from "http";
import { executeQuery } from "./controller/userController.js";
import isValidMessage from "./utils/isValidMessage.js";
import calculateDistance from "./utils/calculateDistance.js";
import convertHeightToInches from "./utils/convertHeightToInches.js";
//routes
import userRoutes from "./routes/userRoutes.js";
dotenv.config();
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
const corsOptions = {
  origin: [
    "https://www.fansmaps.com",
    "https://fansmaps.com",
    "https://fansmaps.com/messages/",
    "https://www.fansmaps.com/messages/",
    "http://localhost:3000",
    "https://frontend-socket.onrender.com"
  ], // List all allowed origins
  methods: ["GET", "POST", "PUT", "DELETE"], // Add any HTTP methods you want to allow
  allowedHeaders: ["Content-Type", "Authorization"], // Add any headers you expect in the requests
  credentials: true, // If you want to allow credentials such as cookies, authorization headers or TLS client certificates
};

app.use(cors(corsOptions));
app.use("/api", userRoutes);

// Create an HTTP server using the Express app
const server = http.createServer(app);

// Initialize Socket.IO with the server
const io = new Server(server, {
  cors: {
    origin: [
      "https://www.fansmaps.com",
      "https://fansmaps.com",
      "https://fansmaps.com/messages/",
      "https://www.fansmaps.com/messages/",
      "http://localhost:3000",
      "https://frontend-socket.onrender.com"

    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e6
});

app.get("/", (req, res) => {
  res.send("fansmaps");
});



io.on("connection", (socket) => {
  let userId = socket.handshake.query.userId;
  socket.selectedUsersMap = new Map();
  if (userId) {
    socket.userId = userId;
    socket.selectedUsersMap.set(userId, 0);
    socket.join(userId);
    const onlineUsers = Array.from(io.sockets.sockets.values()).map(s => s.userId);
    socket.emit("onlineUsers", onlineUsers);
    socket.broadcast.emit("userOnline", { userId });
    console.log(onlineUsers)
  }

  // socket.on("joinRoom", ({ userId }) => {
  //   if (userId) {
  //     socket.userId = userId;
  //     socket.selectedUsersMap.set(userId, 0);
  //     socket.join(userId);
  //     const onlineUsers = Array.from(io.sockets.sockets.values()).map(s => s.userId);
  //     socket.emit("onlineUsers", onlineUsers);
  //     socket.broadcast.emit("userOnline", { userId });
  //   }
  // });


  socket.on("joinRoomSelectedUser", ({ userId, selectedUserId }) => {
    if (socket.selectedUsersMap.has(userId)) {
      socket.selectedUsersMap.set(userId, selectedUserId);
    }
  });

  socket.on("sendMessage", async (messageData) => {
    const {
      sender_id,
      receiver_id,
      message_text,
      image_url,
      last_message_timestamp,
    } = messageData;

    const chat_id =
      parseInt(sender_id) < parseInt(receiver_id)
        ? `${sender_id}-${receiver_id}`
        : `${receiver_id}-${sender_id}`;

    // *1. Validate Message Data*
    if (
      !sender_id ||
      !receiver_id ||
      !message_text ||
      !last_message_timestamp
    ) {
      socket.emit("errorMessage", { error: "All fields are required." });
      return;
    }

    if (typeof message_text !== "string" || message_text.length > 1000) {
      socket.emit("errorMessage", {
        error: "Message text is invalid or too long.",
      });
      return;
    }

    // *2. Validate Message Text Content*
    if (!isValidMessage(message_text)) {
      socket.emit("errorMessage", {
        error: "Message contains prohibited content.",
      });
      return;
    }

    let isReceiverOnline = false;
    let checkReceiverOnline = false;
    const receiverSocket = Array.from(io.sockets.sockets.values()).find(s => s.userId.toString() === receiver_id.toString());
    if (receiverSocket) {
      const checkRec = receiverSocket.selectedUsersMap.get(receiver_id);
      if (checkRec && checkRec != 0) {
        checkReceiverOnline = true;
      }
      if (receiverSocket.selectedUsersMap.get(receiverSocket.userId) == sender_id) {
        isReceiverOnline = true;
      }
    }



    // *3. Retrieve Filter Data for Receiver*
    const getFilterDataQuery = `SELECT filter_data FROM filter_data WHERE userid = ? LIMIT 1`;

    executeQuery(getFilterDataQuery, [receiver_id], (err, filterResult) => {
      if (err) {
        console.log(err);
        socket.emit("errorMessage", {
          error: "Database error: " + err.message,
        });
        return;
      }

      let isRestricted = 0;
      let blockedWords = [];
      let distanceFilter = 0;

      if (filterResult?.length > 0) {
        // const filterData = JSON.parse(filterResult[0].filter_data);
        let filterData;
        if (typeof filterResult[0].filter_data === 'string') {
          filterData = JSON.parse(filterResult[0].filter_data);
        } else {
          filterData = filterResult[0].filter_data;
        }

        try {
          blockedWords = filterData?.blockedWords || [];
          distanceFilter = filterData?.distance || 0;
          // console.log(filterData)

          if (blockedWords.length > 0) {
            // Check if message_text contains any blocked words
            const messageTextLower = message_text.toLowerCase();
            isRestricted = blockedWords.some(word => messageTextLower.includes(word.toLowerCase())) ? 1 : 0;
          }
        } catch (e) {
          console.log("Error parsing filter data:", e);
        }

        const getLatLngQuery = `
          SELECT p.userid, p.lat, p.lng, p.details, GROUP_CONCAT(rpc.cat_id) AS cat_ids
          FROM places p
          LEFT JOIN rel_place_cat rpc ON p.place_id = rpc.place_id WHERE p.userid IN (?, ?)
          GROUP BY p.userid;
          ;
        `;
        executeQuery(getLatLngQuery, [sender_id, receiver_id], (err, locationResult) => {
          if (err) {
            socket.emit("errorMessage", {
              error: "Database error: " + err.message,
            });
            return;
          }

          if (locationResult?.length == 2) {
            const senderLocation = locationResult.find(loc => loc.userid == sender_id);
            const receiverLocation = locationResult.find(loc => loc.userid == receiver_id);

            if (!senderLocation.lat || !senderLocation.lng || !receiverLocation.lat || !receiverLocation.lng) {
              // isRestricted = 1;
            } else {
              const distance = calculateDistance(senderLocation.lat, senderLocation.lng, receiverLocation.lat, receiverLocation.lng);
              if (distanceFilter >= distance) {
                isRestricted = 1;
              }
            }
            if (senderLocation?.details) {
              const detailData = JSON.parse(senderLocation?.details);
              if (detailData?.age_id && filterData?.ageRange?.length > 0) { // age
                if (parseInt(detailData.age_id) >= parseInt(filterData.ageRange[0]) && parseInt(detailData.age_id) <= parseInt(filterData.ageRange[1])) {
                  isRestricted = 1;
                }
              }

              if (detailData?.height_id && filterData?.heightRange?.length > 0) { //height
                const heightInInches = convertHeightToInches(detailData.height_id);
                const minHeightInInches = convertHeightToInches(filterData.heightRange[0]);
                const maxHeightInInches = convertHeightToInches(filterData.heightRange[1]);

                if (heightInInches !== null && minHeightInInches !== null && maxHeightInInches !== null) {
                  if (heightInInches >= minHeightInInches && heightInInches <= maxHeightInInches) {
                    isRestricted = 1;
                  }
                }
              }

              if (detailData?.ethnicity_id && filterData?.ethnicities?.length > 0) { //ethy..
                let ethy = detailData.ethnicity_id.toLowerCase();
                if (filterData.ethnicities.includes(ethy)) {
                  isRestricted = 1
                }
              }
              if (senderLocation.cat_ids && filterData.profileTypes?.length > 0) { //profile types
                const catIdsArray = senderLocation.cat_ids.split(',').map(Number);
                const checkValue = filterData.profileTypes.some(profileType => catIdsArray.includes(profileType));
                if (checkValue) {
                  isRestricted = 1;
                }
              }
            }
          }

          // *2. Check User Plan*
          const getPlanQuery = `SELECT DISTINCT plan FROM places WHERE userid = ? LIMIT 1`;
          executeQuery(getPlanQuery, [sender_id], (err, planResult) => {
            if (err) {
              console.log(err);
              socket.emit("errorMessage", {
                error: "Database error: " + err.message,
              });
              return;
            }

            if (planResult?.length > 0 && planResult[0].plan == 1) {
              // This is a free user, check the daily message limit
              const getLimitQuery = `SELECT free_messages_per_day FROM free_messages_limit LIMIT 1`;
              executeQuery(getLimitQuery, [], (err, limitResult) => {
                if (err) {
                  console.log(err);
                  socket.emit("errorMessage", {
                    error: "Database error: " + err.message,
                  });
                  return;
                }

                if (limitResult?.length > 0) {
                  const dailyLimit = limitResult[0].free_messages_per_day;

                  const checkMessagesQuery = `
          SELECT COUNT(*) AS message_count
          FROM messages
          WHERE sender_id = ? 
          AND DATE(timestamp) = CURDATE()
        `;

                  executeQuery(checkMessagesQuery, [sender_id], (err, countResult) => {
                    if (err) {
                      console.log(err);
                      socket.emit("errorMessage", {
                        error: "Database error: " + err.message,
                      });
                      return;
                    }

                    const messageCount = countResult[0].message_count;

                    if (messageCount >= dailyLimit) {
                      socket.emit("errorMessage", {
                        error: "Messages have reached today's limit.",
                      });
                      return; // Stop further execution if the limit is reached
                    }

                    // *3. Save Message to the Database*
                    const query = `
            INSERT INTO messages (sender_id, receiver_id, message_text, image_url, timestamp, is_read, is_pinned,restricted)
            VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)
          `;

                    executeQuery(
                      query,
                      [
                        sender_id,
                        receiver_id,
                        message_text,
                        image_url,
                        isReceiverOnline ? 0 : 1,
                        0,
                        isRestricted
                      ],
                      (err, result) => {
                        if (err) {
                          socket.emit("errorMessage", {
                            error: "Database error: " + err.message,
                          });
                          return;
                        }

                        const query1 = `
                INSERT INTO chats (chat_id, user1_id, user2_id, last_message_id, last_message_timestamp)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                last_message_id = VALUES(last_message_id),
                last_message_timestamp = VALUES(last_message_timestamp);
              `;

                        executeQuery(
                          query1,
                          [
                            chat_id,
                            sender_id,
                            receiver_id,
                            result.insertId,
                            last_message_timestamp,
                          ],
                          (err, result) => {
                            if (err) {
                              console.log(err);
                              socket.emit("errorMessage", {
                                error: "Database error: " + err.message,
                              });
                              return;
                            }
                            // console.log("Message successfully saved.");
                          }
                        );

                        const newMessage = {
                          id: result.insertId,
                          sender_id,
                          receiver_id,
                          message_text,
                          image_url,
                          timestamp: new Date(),
                          is_read: isReceiverOnline ? 0 : 1,
                          is_pinned: 0,
                          is_restricted: isRestricted,
                          receiver_online: checkReceiverOnline ? 1 : 0
                        };

                        // *4. Emit the Message to the Receiver*
                        if (sender_id == receiver_id) {
                          io.to(sender_id).emit("receiveMessage", newMessage);
                        } else {
                          io.to(sender_id).emit("receiveMessage", newMessage);
                          io.to(receiver_id).emit("receiveMessage", newMessage);
                          socket.broadcast.emit("sendForOfflineUsers", newMessage);
                        }
                      }
                    );

                  });
                }
              });
            } else {
              // *3. Save Message to the Database* (For non-free users)
              let is_pinned = 0;
              if (planResult?.length > 0) {
                is_pinned =
                  planResult[0].plan == 6 || planResult[0].plan == 8 ? 1 : 0;
              }
              // console.log(is_pinned, planResult[0]?.plan);
              const query = `
      INSERT INTO messages (sender_id, receiver_id, message_text, image_url, timestamp, is_read, is_pinned ,restricted)
      VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)
    `;

              executeQuery(
                query,
                [
                  sender_id,
                  receiver_id,
                  message_text,
                  image_url,
                  isReceiverOnline ? 0 : 1,
                  is_pinned,
                  isRestricted
                ],
                (err, result) => {
                  if (err) {
                    socket.emit("errorMessage", {
                      error: "Database error: " + err.message,
                    });
                    return;
                  }

                  const query1 = `
          INSERT INTO chats (chat_id, user1_id, user2_id, last_message_id, last_message_timestamp)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
          last_message_id = VALUES(last_message_id),
          last_message_timestamp = VALUES(last_message_timestamp);
        `;

                  executeQuery(
                    query1,
                    [
                      chat_id,
                      sender_id,
                      receiver_id,
                      result.insertId,
                      last_message_timestamp,
                    ],
                    (err, result) => {
                      if (err) {
                        console.log(err);
                        socket.emit("errorMessage", {
                          error: "Database error: " + err.message,
                        });
                        return;
                      }
                      // console.log("Message successfully saved.");
                    }
                  );

                  const newMessage = {
                    id: result.insertId,
                    sender_id,
                    receiver_id,
                    message_text,
                    image_url,
                    timestamp: new Date(),
                    is_read: isReceiverOnline ? 0 : 1,
                    is_pinned: is_pinned,
                    is_restricted: isRestricted,
                    receiver_online: checkReceiverOnline ? 1 : 0
                  };

                  // *4. Emit the Message to the Receiver*
                  if (sender_id == receiver_id) {
                    io.to(sender_id).emit("receiveMessage", newMessage);
                  } else {
                    io.to(sender_id).emit("receiveMessage", newMessage);
                    io.to(receiver_id).emit("receiveMessage", newMessage);
                    socket.broadcast.emit("sendForOfflineUsers", newMessage);
                  }
                }
              );
            }
          });

        })
      }
      else {
        // *2. Check User Plan*
        const getPlanQuery = `SELECT DISTINCT plan FROM places WHERE userid = ? LIMIT 1`;
        executeQuery(getPlanQuery, [sender_id], (err, planResult) => {
          if (err) {
            console.log(err);
            socket.emit("errorMessage", {
              error: "Database error: " + err.message,
            });
            return;
          }

          if (planResult?.length > 0 && planResult[0].plan == 1) {
            // This is a free user, check the daily message limit
            const getLimitQuery = `SELECT free_messages_per_day FROM free_messages_limit LIMIT 1`;
            executeQuery(getLimitQuery, [], (err, limitResult) => {
              if (err) {
                console.log(err);
                socket.emit("errorMessage", {
                  error: "Database error: " + err.message,
                });
                return;
              }

              if (limitResult?.length > 0) {
                const dailyLimit = limitResult[0].free_messages_per_day;

                const checkMessagesQuery = `
        SELECT COUNT(*) AS message_count
        FROM messages
        WHERE sender_id = ? 
        AND DATE(timestamp) = CURDATE()
      `;

                executeQuery(checkMessagesQuery, [sender_id], (err, countResult) => {
                  if (err) {
                    console.log(err);
                    socket.emit("errorMessage", {
                      error: "Database error: " + err.message,
                    });
                    return;
                  }

                  const messageCount = countResult[0]?.message_count;

                  if (messageCount >= dailyLimit) {
                    socket.emit("errorMessage", {
                      error: "Messages have reached today's limit.",
                    });
                    return; // Stop further execution if the limit is reached
                  }

                  // *3. Save Message to the Database*
                  const query = `
          INSERT INTO messages (sender_id, receiver_id, message_text, image_url, timestamp, is_read, is_pinned,restricted)
          VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)
        `;

                  executeQuery(
                    query,
                    [
                      sender_id,
                      receiver_id,
                      message_text,
                      image_url,
                      isReceiverOnline ? 0 : 1,
                      0,
                      isRestricted
                    ],
                    (err, result) => {
                      if (err) {
                        socket.emit("errorMessage", {
                          error: "Database error: " + err.message,
                        });
                        return;
                      }

                      const query1 = `
              INSERT INTO chats (chat_id, user1_id, user2_id, last_message_id, last_message_timestamp)
              VALUES (?, ?, ?, ?, ?)
              ON DUPLICATE KEY UPDATE
              last_message_id = VALUES(last_message_id),
              last_message_timestamp = VALUES(last_message_timestamp);
            `;

                      executeQuery(
                        query1,
                        [
                          chat_id,
                          sender_id,
                          receiver_id,
                          result.insertId,
                          last_message_timestamp,
                        ],
                        (err, result) => {
                          if (err) {
                            console.log(err);
                            socket.emit("errorMessage", {
                              error: "Database error: " + err.message,
                            });
                            return;
                          }
                          // console.log("Message successfully saved.");
                        }
                      );

                      const newMessage = {
                        id: result.insertId,
                        sender_id,
                        receiver_id,
                        message_text,
                        image_url,
                        timestamp: new Date(),
                        is_read: isReceiverOnline ? 0 : 1,
                        is_pinned: 0,
                        is_restricted: isRestricted,
                        receiver_online: checkReceiverOnline ? 1 : 0
                      };

                      // *4. Emit the Message to the Receiver*
                      if (sender_id == receiver_id) {
                        io.to(sender_id).emit("receiveMessage", newMessage);
                      } else {
                        io.to(sender_id).emit("receiveMessage", newMessage);
                        io.to(receiver_id).emit("receiveMessage", newMessage);
                        socket.broadcast.emit("sendForOfflineUsers", newMessage);
                      }
                    }
                  );

                });
              }
            });
          } else {
            // *3. Save Message to the Database* (For non-free users)
            let is_pinned = 0;
            if (planResult?.length > 0) {
              is_pinned =
                planResult[0].plan == 6 || planResult[0].plan == 8 ? 1 : 0;
            }
            // console.log(is_pinned, planResult[0]?.plan);
            const query = `
    INSERT INTO messages (sender_id, receiver_id, message_text, image_url, timestamp, is_read, is_pinned ,restricted)
    VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)
  `;

            executeQuery(
              query,
              [
                sender_id,
                receiver_id,
                message_text,
                image_url,
                isReceiverOnline ? 0 : 1,
                is_pinned,
                isRestricted
              ],
              (err, result) => {
                if (err) {
                  socket.emit("errorMessage", {
                    error: "Database error: " + err.message,
                  });
                  return;
                }

                const query1 = `
        INSERT INTO chats (chat_id, user1_id, user2_id, last_message_id, last_message_timestamp)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
        last_message_id = VALUES(last_message_id),
        last_message_timestamp = VALUES(last_message_timestamp);
      `;

                executeQuery(
                  query1,
                  [
                    chat_id,
                    sender_id,
                    receiver_id,
                    result.insertId,
                    last_message_timestamp,
                  ],
                  (err, result) => {
                    if (err) {
                      console.log(err);
                      socket.emit("errorMessage", {
                        error: "Database error: " + err.message,
                      });
                      return;
                    }
                    // console.log("Message successfully saved.");
                  }
                );

                const newMessage = {
                  id: result.insertId,
                  sender_id,
                  receiver_id,
                  message_text,
                  image_url,
                  timestamp: new Date(),
                  is_read: isReceiverOnline ? 0 : 1,
                  is_pinned: is_pinned,
                  is_restricted: isRestricted,
                  receiver_online: checkReceiverOnline ? 1 : 0
                };

                // *4. Emit the Message to the Receiver*
                if (sender_id == receiver_id) {
                  io.to(sender_id).emit("receiveMessage", newMessage);
                } else {
                  io.to(sender_id).emit("receiveMessage", newMessage);
                  io.to(receiver_id).emit("receiveMessage", newMessage);
                  socket.broadcast.emit("sendForOfflineUsers", newMessage);
                }
              }
            );
          }
        });

      }

    })

  });


  socket.on("messageRead", (messageId) => {
    const updateQuery = `
  UPDATE messages 
  SET 
    is_pinned = false, 
    is_read = false 
  WHERE 
    id = ?;
`;

    executeQuery(updateQuery, [messageId], (err, result) => {
      if (err) {
        console.log("Error unpinning message:", err.message);
      }
      socket.broadcast.emit("senderRead", messageId);
    });
  });

  // Handle when a user starts typing
  socket.on("typing", (data) => {
    io.to(data.receiverId).emit("typing", { senderId: data.senderId });
  });

  // Handle when a user stops typing
  socket.on("stopTyping", (data) => {
    io.to(data.receiverId).emit("stopTyping", { senderId: data.senderId });
  });

  socket.on("userLeftChat", (userId) => {
    // if (onlineUsers.has(userId)) {
    //   onlineUsers.delete(userId);
    //   socket.broadcast.emit("userOffline", { userId });
    // }
  });

  socket.on("removeSelectedUser", (userId) => {
    if (socket.selectedUsersMap.has(userId)) {
      socket.selectedUsersMap.set(userId, 0);
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const userId = socket.userId;
    if (userId) {
      socket.selectedUsersMap.clear();
      socket.broadcast.emit("userOffline", { userId });
    }
  });

});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
