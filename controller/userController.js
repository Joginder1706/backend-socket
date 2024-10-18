import db from "../db/db.js";

// Handle the database connection state and query execution
const handleDbQuery = (query, params = [], res) => {
  if (db.state === "disconnected") {
    console.error("Database connection is closed. Reconnecting...");

    db.connect((err) => {
      if (err) {
        console.error("Failed to reconnect to the database:", err);
        return res.status(500).json({
          error: {
            message: "Failed to reconnect to the database.",
            details: err.message,
            code: err.code,
            stack: err.stack,
          },
        });
      }

      db.query(query, params, (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res.status(500).json({
            error: {
              message: "An error occurred while executing the database query.",
              details: err.message,
              code: err.code,
              stack: err.stack,
            },
          });
        }
        return res.json(results);
      });
    });
  } else {
    db.query(query, params, (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res.status(500).json({
          error: {
            message: "An error occurred while executing the database query.",
            details: err.message,
            code: err.code,
            stack: err.stack,
          },
        });
      }
      return res.json(results);
    });
  }
};

export const executeQuery = (query, params = [], callback) => {
  if (db.state === "disconnected") {
    console.log("Database disconnected, reconnecting...");
    db.connect((err) => {
      if (err) {
        console.error("Failed to reconnect to the database:", err);
        return callback({
          error: {
            message: "Failed to reconnect to the database.",
            details: err.message,
            code: err.code,
            stack: err.stack,
          },
        });
      }
      db.query(query, params, callback);
    });
  } else {
    db.query(query, params, callback);
  }
};

export const getUserById = (req, res) => {
  const id = req.params.id;

  const query = `
  SELECT DISTINCT
    users.first_name, 
    users.gender, 
    users.created, 
    users.active_date,
    users.archived_users,
    users.block_users,
    places.place_id,
    places.place_name,
    places.submission_date,
    places.logo, 
    places.plan, 
    places.description,
    places.characters_description,
    places.short_desc, 
    places.details, 
    places.healthtest_date,
    places.slug AS place_slug,
    cities.city_name,
    cities.slug AS city_slug,
    states.state_name,
    states.slug AS state_slug,
    countries.country_name,
    cats.cat_slug,
    delete_user_conversation.deleted_users,
    CONCAT(
      '[', 
      GROUP_CONCAT(
        CONCAT(
          '{"dir": "', p.dir, '", "filename": "', p.filename, '"}'
        )
      ), 
      ']'
    ) AS photos
  FROM users 
  LEFT JOIN places 
  ON users.id = places.userid 
  AND places.status = 'approved'
  LEFT JOIN cities
  ON places.city_id = cities.city_id
  LEFT JOIN states
  ON cities.state_id = states.state_id
  LEFT JOIN countries
  ON states.country_id = countries.country_id
  LEFT JOIN photos p 
  ON p.place_id = places.place_id
  LEFT JOIN delete_user_conversation
  ON delete_user_conversation.user_id = ${id}
  LEFT JOIN rel_place_cat rpc
  ON places.place_id = rpc.place_id AND rpc.is_main = 1
  LEFT JOIN cats 
  ON rpc.cat_id = cats.id
  WHERE users.id = ${id}
  GROUP BY 
    users.first_name, 
    users.gender, 
    users.created, 
    users.active_date,
    users.archived_users,
    users.block_users,
    places.place_id,
    places.place_name,
    places.submission_date,
    places.logo, 
    places.plan, 
    places.description,
    places.characters_description,
    places.short_desc, 
    places.details, 
    places.healthtest_date,
    places.slug,
    cities.city_name,
    cities.slug,
    states.state_name,
    states.slug,
    countries.country_name,
    cats.cat_slug,
    delete_user_conversation.deleted_users
`;

  handleDbQuery(query, [id], res);
};

export const getInboxMessages = (req, res) => {
  const id = req.query.userid;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const offset = (page - 1) * limit;

  const query = `
  WITH ranked_messages AS (
    SELECT 
      u.*, 
      msg.id AS message_id,
      msg.is_pinned,
      msg.is_read,
      p.logo,
      p.place_name,
      m.message_text,
      msg.restricted,
      c.last_message_timestamp,
      cities.city_name AS place_city_name,
      states.state_name AS place_state_name,
      countries.country_name AS place_country_name,
      ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY msg.id DESC) AS rn
    FROM 
      messages msg
    JOIN 
      users u ON msg.sender_id = u.id
    LEFT JOIN 
      places p ON p.userid = u.id
      AND p.status = 'approved'
    LEFT JOIN 
      cities ON p.city_id = cities.city_id
    LEFT JOIN 
      states ON cities.state_id = states.state_id
    LEFT JOIN 
      countries ON states.country_id = countries.country_id
    LEFT JOIN 
      chats c ON (c.user1_id = ${id} OR c.user2_id = ${id})
    LEFT JOIN 
      messages m ON c.last_message_id = m.id
    WHERE 
      msg.receiver_id = ${id}
      AND (c.user1_id = u.id OR c.user2_id = u.id)
      AND NOT EXISTS (
        SELECT 1 
        FROM users receiver 
        WHERE receiver.id = ${id}
        AND FIND_IN_SET(u.id, REPLACE(REPLACE(REPLACE(receiver.archived_users, '[', ''), ']', ''), '"', ''))
      )
      AND NOT EXISTS (
        SELECT 1
        FROM users blocker
        WHERE blocker.id = ${id}
        AND FIND_IN_SET(u.id, REPLACE(REPLACE(REPLACE(blocker.block_users, '[', ''), ']', ''), '"', ''))
      )
  )
  SELECT 
    u.*, 
    is_pinned, 
    message_text AS last_message_text, 
    message_id AS last_message_id, 
    is_read AS last_message_is_read, 
    last_message_timestamp,
    logo,
    place_name,
    place_city_name,
    place_state_name,
    place_country_name
  FROM 
    ranked_messages u
  WHERE 
    rn = 1
    AND restricted != 1
  ORDER BY 
    last_message_id DESC
  LIMIT ${limit} OFFSET ${offset};
  `;

  executeQuery(query, [], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const userIds = results.map(user => user.id);

    if (userIds.length === 0) {
      return res.json([]);
    }

    const queryMessage = `
  SELECT m.*
  FROM chats c
  JOIN messages m ON c.last_message_id = m.id
  WHERE (
    (c.user1_id = ? AND c.user2_id IN (?))
    OR (c.user2_id = ? AND c.user1_id IN (?))
  )
  ORDER BY m.timestamp DESC;
`;
    executeQuery(queryMessage, [id, userIds, id, userIds], (err, messagesList) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const newResult = results.map((item) => {
        const singleUser = messagesList.find(message => item.id == message.sender_id || item.id == message.receiver_id);
        return {
          ...item, message: singleUser
        }

      })

      // Step 2: Fetch deleted users from `delete_user_conversation`

      const deletedUsersQuery = `SELECT deleted_users FROM delete_user_conversation WHERE user_id = ?`;
      executeQuery(deletedUsersQuery, [id], (err, deleteResults) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        // Step 3: Parse deleted_users and filter results
        let deletedUsers = [];
        if (deleteResults.length > 0 && deleteResults[0].deleted_users) {
          try {
            deletedUsers = JSON.parse(deleteResults[0].deleted_users);
          } catch (e) {
            return res.status(500).json({ error: 'Failed to parse deleted users' });
          }
        }

        // Step 4: Filter the results to exclude users where deleted_users.timestamp > last_message_timestamp
        const filteredResults = newResult.filter((message) => {
          // Find matching user in deleted_users
          const deletedUser = deletedUsers.find(user => user.id.toString() === message.id.toString());

          // If no match in deleted_users, include the message
          if (!deletedUser) {
            return true;
          }

          // If match found, compare timestamps
          const deletedTimestamp = new Date(deletedUser.timestamp).getTime();
          const messageTimestamp = new Date(message.message.timestamp).getTime();
          return messageTimestamp > deletedTimestamp;
        });

        const userIdFilters = filteredResults.map(user => user.id);
        const queryMessageFilter = `
    SELECT m.*
    FROM messages m
    WHERE (
      (m.sender_id = ? AND m.receiver_id IN (?))
      OR (m.receiver_id = ? AND m.sender_id IN (?))
    )
    ORDER BY m.timestamp DESC;
  `;

        executeQuery(queryMessageFilter, [id, userIdFilters, id, userIdFilters], (err, list) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          const output = filteredResults?.map((item) => {
            const userMessages = list?.filter(
              message => (message.sender_id == id && message.receiver_id == item.id) ||
                (message.receiver_id == id && message.sender_id == item.id)
            );
            return { ...item, messageList: userMessages };
          });

          const filteredMessagesByTimeStamp = output?.filter((item) => {
            const deletedUser = deletedUsers?.find(user => user.id.toString() === item.id.toString());

            if (!deletedUser) {
              return true;
            }
            const deletedTimestamp = new Date(deletedUser.timestamp).getTime();
            const filteredMessageList = item.messageList?.filter((message) => {
              const messageTimestamp = new Date(message.timestamp).getTime();
              return messageTimestamp > deletedTimestamp;
            });
            item.messageList = filteredMessageList;

            // Only return users with messages after the deletedTimestamp
            return filteredMessageList.length > 0;
          });


          const removeUser = filteredMessagesByTimeStamp?.filter((element) => {
            const check = element.messageList?.find(item => item.receiver_id.toString() === id.toString());
            return check !== undefined;
          });
          return res.json(removeUser);

        })

      });

    })


  });

};

export const getFilteredMessages = (req, res) => {
  const id = req.query.userid;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const offset = (page - 1) * limit;

  const query = `
    WITH ranked_messages AS (
      SELECT 
        u.*, 
        msg.id AS message_id,
        msg.is_pinned,
        msg.is_read,
        c.last_message_timestamp,
        p.logo,
        p.place_name,
        m.message_text,
        msg.restricted,
        cities.city_name AS place_city_name,
        states.state_name AS place_state_name,
        countries.country_name AS place_country_name,
        ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY msg.id DESC) AS rn
      FROM 
        messages msg
      JOIN 
        users u ON msg.sender_id = u.id
      LEFT JOIN 
        places p ON p.userid = u.id
        AND p.status = 'approved'
      LEFT JOIN 
        cities ON p.city_id = cities.city_id
      LEFT JOIN 
        states ON cities.state_id = states.state_id
      LEFT JOIN 
        countries ON states.country_id = countries.country_id
      LEFT JOIN 
        chats c ON (c.user1_id = ${id} OR c.user2_id = ${id})
      LEFT JOIN 
        messages m ON c.last_message_id = m.id
      WHERE 
        msg.receiver_id = ${id}
        AND (c.user1_id = u.id OR c.user2_id = u.id)
        AND NOT EXISTS (
        SELECT 1
        FROM users blocker
        WHERE blocker.id = ${id}
        AND FIND_IN_SET(u.id, REPLACE(REPLACE(REPLACE(blocker.block_users, '[', ''), ']', ''), '"', ''))
      )
    )
    SELECT 
      u.*, 
      is_pinned, 
      message_text AS last_message_text, 
      message_id AS last_message_id, 
      is_read AS last_message_is_read, 
      last_message_timestamp,
      logo,
      place_name,
      place_city_name,
      place_state_name,
      place_country_name
    FROM 
      ranked_messages u
    WHERE 
      rn = 1
      AND restricted = 1
    ORDER BY 
      last_message_id DESC
    LIMIT ${limit} OFFSET ${offset};
  `;

  executeQuery(query, [], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const userIds = results.map(user => user.id);

    if (userIds.length === 0) {
      return res.json([]);
    }

    const queryMessage = `
  SELECT m.*
  FROM chats c
  JOIN messages m ON c.last_message_id = m.id
  WHERE (
    (c.user1_id = ? AND c.user2_id IN (?))
    OR (c.user2_id = ? AND c.user1_id IN (?))
  )
  ORDER BY m.timestamp DESC;
`;
    executeQuery(queryMessage, [id, userIds, id, userIds], (err, messagesList) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const newResult = results.map((item) => {
        const singleUser = messagesList.find(message => item.id == message.sender_id || item.id == message.receiver_id);
        return {
          ...item, message: singleUser
        }

      })

      // Step 2: Fetch deleted users from `delete_user_conversation`

      const deletedUsersQuery = `SELECT deleted_users FROM delete_user_conversation WHERE user_id = ?`;
      executeQuery(deletedUsersQuery, [id], (err, deleteResults) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        // Step 3: Parse deleted_users and filter results
        let deletedUsers = [];
        if (deleteResults.length > 0 && deleteResults[0].deleted_users) {
          try {
            deletedUsers = JSON.parse(deleteResults[0].deleted_users);
          } catch (e) {
            return res.status(500).json({ error: 'Failed to parse deleted users' });
          }
        }

        // Step 4: Filter the results to exclude users where deleted_users.timestamp > last_message_timestamp
        const filteredResults = newResult.filter((message) => {
          // Find matching user in deleted_users
          const deletedUser = deletedUsers.find(user => user.id.toString() === message.id.toString());

          // If no match in deleted_users, include the message
          if (!deletedUser) {
            return true;
          }

          // If match found, compare timestamps
          const deletedTimestamp = new Date(deletedUser.timestamp).getTime();
          const messageTimestamp = new Date(message.message.timestamp).getTime();
          return messageTimestamp > deletedTimestamp;
        });

        return res.json(filteredResults);
      });

    })


  });

};

export const getSentMessages = (req, res) => {
  const id = req.query.userid;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const offset = (page - 1) * limit;

  const query = `
  WITH ranked_messages AS (
    SELECT 
      u.*, 
      msg.id AS message_id,
      msg.is_pinned,
      msg.is_read,
      c.last_message_timestamp,
      p.logo,
      p.place_name,
      cities.city_name AS place_city_name,
      states.state_name AS place_state_name,
      countries.country_name AS place_country_name,
      (SELECT m.message_text 
       FROM chats c
       JOIN messages m ON c.last_message_id = m.id
       WHERE (c.user1_id = ${id} OR c.user2_id = ${id})
       AND (c.user1_id = u.id OR c.user2_id = u.id)
       ORDER BY m.timestamp DESC
       LIMIT 1) AS last_message_text,
      ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY msg.id DESC) AS rn
    FROM 
      messages msg
    JOIN 
      users u ON msg.receiver_id = u.id
    LEFT JOIN 
      places p ON p.userid = u.id
      AND p.status = 'approved'
    LEFT JOIN 
      cities ON p.city_id = cities.city_id
    LEFT JOIN 
      states ON cities.state_id = states.state_id
    LEFT JOIN 
      countries ON states.country_id = countries.country_id
    LEFT JOIN 
      chats c ON (c.user1_id = ${id} OR c.user2_id = ${id}) AND (c.user1_id = u.id OR c.user2_id = u.id) -- Ensure proper join
    WHERE 
      msg.sender_id = ${id}
      AND NOT EXISTS (
      SELECT 1
      FROM users blocker
      WHERE blocker.id = ${id}
      AND FIND_IN_SET(u.id, REPLACE(REPLACE(REPLACE(blocker.block_users, '[', ''), ']', ''), '"', ''))
    )
  )
  SELECT 
    u.*, 
    last_message_text, 
    last_message_timestamp,
    is_pinned,
    is_read,
    logo, 
    place_name,
    place_city_name,
    place_state_name,
    place_country_name
  FROM 
    ranked_messages u
  WHERE 
    rn = 1
  ORDER BY 
    message_id DESC
  LIMIT ${limit} OFFSET ${offset};
  `;

  executeQuery(query, [], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const userIds = results.map(user => user.id);

    if (userIds.length === 0) {
      return res.json([]);
    }

    const queryMessage = `
  SELECT m.*
  FROM chats c
  JOIN messages m ON c.last_message_id = m.id
  WHERE (
    (c.user1_id = ? AND c.user2_id IN (?))
    OR (c.user2_id = ? AND c.user1_id IN (?))
  )
  ORDER BY m.timestamp DESC;
`;
    executeQuery(queryMessage, [id, userIds, id, userIds], (err, messagesList) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const newResult = results.map((item) => {
        const singleUser = messagesList.find(message => item.id == message.sender_id || item.id == message.receiver_id);
        return {
          ...item, message: singleUser
        }

      })

      // Step 2: Fetch deleted users from `delete_user_conversation`

      const deletedUsersQuery = `SELECT deleted_users FROM delete_user_conversation WHERE user_id = ?`;
      executeQuery(deletedUsersQuery, [id], (err, deleteResults) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        // Step 3: Parse deleted_users and filter results
        let deletedUsers = [];
        if (deleteResults.length > 0 && deleteResults[0].deleted_users) {
          try {
            deletedUsers = JSON.parse(deleteResults[0].deleted_users);
          } catch (e) {
            return res.status(500).json({ error: 'Failed to parse deleted users' });
          }
        }

        // Step 4: Filter the results to exclude users where deleted_users.timestamp > last_message_timestamp
        const filteredResults = newResult.filter((message) => {
          // Find matching user in deleted_users
          const deletedUser = deletedUsers.find(user => user.id.toString() === message.id.toString());

          // If no match in deleted_users, include the message
          if (!deletedUser) {
            return true;
          }

          // If match found, compare timestamps
          const deletedTimestamp = new Date(deletedUser.timestamp).getTime();
          const messageTimestamp = new Date(message.message.timestamp).getTime();
          return messageTimestamp > deletedTimestamp;
        });

        const userIdFilters = filteredResults.map(user => user.id);
        const queryMessageFilter = `
    SELECT m.*
    FROM messages m
    WHERE (
      (m.sender_id = ? AND m.receiver_id IN (?))
      OR (m.receiver_id = ? AND m.sender_id IN (?))
    )
    ORDER BY m.timestamp DESC;
  `;

        executeQuery(queryMessageFilter, [id, userIdFilters, id, userIdFilters], (err, list) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          const output = filteredResults?.map((item) => {
            const userMessages = list?.filter(
              message => (message.sender_id == id && message.receiver_id == item.id) ||
                (message.receiver_id == id && message.sender_id == item.id)
            );
            return { ...item, messageList: userMessages };
          });

          const filteredMessagesByTimeStamp = output?.filter((item) => {
            const deletedUser = deletedUsers?.find(user => user.id.toString() === item.id.toString());

            if (!deletedUser) {
              return true;
            }
            const deletedTimestamp = new Date(deletedUser.timestamp).getTime();
            const filteredMessageList = item.messageList?.filter((message) => {
              const messageTimestamp = new Date(message.timestamp).getTime();
              return messageTimestamp > deletedTimestamp;
            });
            item.messageList = filteredMessageList;

            // Only return users with messages after the deletedTimestamp
            return filteredMessageList.length > 0;
          });


          const removeUser = filteredMessagesByTimeStamp?.filter((element) => {
            const check = element.messageList?.find(item => item.sender_id.toString() === id.toString());
            return check !== undefined;
          });
          return res.json(removeUser);
        })

      });

    })


  });
};

export const getSingleUserMessage = (req, res) => {
  const { id1, id2 } = req.params;
  const query = `
    SELECT * FROM messages 
    WHERE 
      (sender_id = ? AND receiver_id = ?) 
      OR 
      (sender_id = ? AND receiver_id = ?)
    ORDER BY timestamp ASC
  `;

  handleDbQuery(query, [id1, id2, id2, id1], res);
};

export const getCategories = (req, res) => {

  const id = req.params.id;

  const query = `
  SELECT 
    'cats_data' AS data_type,
    cats.id, 
    cats.name, 
    cats.cat_status
  FROM cats
  WHERE cats.cat_status = 1
  
  UNION ALL
  
  SELECT 
    'filter_data' AS data_type,
    NULL AS id,
    NULL AS name,
    filter_data.filter_data AS filter_data
  FROM filter_data
  WHERE filter_data.userid = ?;
`;

  executeQuery(query, [id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const catsData = results.filter(row => row.data_type === 'cats_data');
    const filterData = results.filter(row => row.data_type === 'filter_data');

    res.json({
      cats_data: catsData,
      filter_data: filterData
    });

  })

};

export const postFilterData = (req, res) => {
  const userid = req.params.id;
  const filter_data = JSON.stringify(req.body);

  const query = `
    INSERT INTO filter_data (userid, filter_data)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE filter_data = VALUES(filter_data);
  `;

  const params = [userid, filter_data];

  handleDbQuery(query, params, res);
};

export const getArchiveMessages = (req, res) => {
  const id = req.query.userid;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 15;
  const offset = (page - 1) * limit;

  const query = `
  WITH ranked_messages AS (
    SELECT 
      u.*, 
      msg.id AS message_id,
      msg.is_pinned,
      msg.is_read,
      c.last_message_timestamp,
      p.logo,
      p.place_name,
      m.message_text,
      msg.restricted,
      cities.city_name AS place_city_name,
      states.state_name AS place_state_name,
      countries.country_name AS place_country_name,
      ROW_NUMBER() OVER (PARTITION BY u.id ORDER BY msg.id DESC) AS rn
    FROM 
      messages msg
    JOIN 
      users u ON msg.sender_id = u.id
    LEFT JOIN 
      places p ON p.userid = u.id
      AND p.status = 'approved'
    LEFT JOIN 
      cities ON p.city_id = cities.city_id
    LEFT JOIN 
      states ON cities.state_id = states.state_id
    LEFT JOIN 
      countries ON states.country_id = countries.country_id
    LEFT JOIN 
      chats c ON (c.user1_id = ${id} OR c.user2_id = ${id})
    LEFT JOIN 
      messages m ON c.last_message_id = m.id
    WHERE 
      msg.receiver_id = ${id}
      AND (c.user1_id = u.id OR c.user2_id = u.id)
      AND EXISTS (
        SELECT 1 
        FROM users receiver 
        WHERE receiver.id = ${id}
        AND FIND_IN_SET(u.id, REPLACE(REPLACE(REPLACE(receiver.archived_users, '[', ''), ']', ''), '"', ''))
      )
      AND NOT EXISTS (
        SELECT 1
        FROM users blocker
        WHERE blocker.id = ${id}
        AND FIND_IN_SET(u.id, REPLACE(REPLACE(REPLACE(blocker.block_users, '[', ''), ']', ''), '"', ''))
    )  
  )
  SELECT 
    u.*, 
    is_pinned, 
    message_text AS last_message_text, 
    message_id AS last_message_id, 
    is_read AS last_message_is_read, 
    last_message_timestamp,
    logo,
    place_name,
    place_city_name,
    place_state_name,
    place_country_name
  FROM 
    ranked_messages u
  WHERE 
    rn = 1
    AND restricted != 1
  ORDER BY 
    last_message_id DESC
  LIMIT ${limit} OFFSET ${offset};
  `;
  executeQuery(query, [], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const userIds = results.map(user => user.id);

    if (userIds.length === 0) {
      return res.json([]);
    }

    const queryMessage = `
  SELECT m.*
  FROM chats c
  JOIN messages m ON c.last_message_id = m.id
  WHERE (
    (c.user1_id = ? AND c.user2_id IN (?))
    OR (c.user2_id = ? AND c.user1_id IN (?))
  )
  ORDER BY m.timestamp DESC;
`;
    executeQuery(queryMessage, [id, userIds, id, userIds], (err, messagesList) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const newResult = results.map((item) => {
        const singleUser = messagesList.find(message => item.id == message.sender_id || item.id == message.receiver_id);
        return {
          ...item, message: singleUser
        }

      })

      // Step 2: Fetch deleted users from `delete_user_conversation`

      const deletedUsersQuery = `SELECT deleted_users FROM delete_user_conversation WHERE user_id = ?`;
      executeQuery(deletedUsersQuery, [id], (err, deleteResults) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        // Step 3: Parse deleted_users and filter results
        let deletedUsers = [];
        if (deleteResults.length > 0 && deleteResults[0].deleted_users) {
          try {
            deletedUsers = JSON.parse(deleteResults[0].deleted_users);
          } catch (e) {
            return res.status(500).json({ error: 'Failed to parse deleted users' });
          }
        }

        // Step 4: Filter the results to exclude users where deleted_users.timestamp > last_message_timestamp
        const filteredResults = newResult.filter((message) => {
          // Find matching user in deleted_users
          const deletedUser = deletedUsers.find(user => user.id.toString() === message.id.toString());

          // If no match in deleted_users, include the message
          if (!deletedUser) {
            return true;
          }

          // If match found, compare timestamps
          const deletedTimestamp = new Date(deletedUser.timestamp).getTime();
          const messageTimestamp = new Date(message.message.timestamp).getTime();
          return messageTimestamp > deletedTimestamp;
        });

        return res.json(filteredResults);
      });

    })


  });
};

export const saveArchivedUser = (req, res) => {
  const userid = req.params.id;
  let splitId = userid.split("-")[0];
  let path = userid.split("-")[1];

  const { id } = req.body;

  if (path === "filtered") {
    const updateFilteredQuery = `
      UPDATE messages 
      SET restricted = 0 
      WHERE sender_id = ? AND receiver_id = ?`;

    executeQuery(updateFilteredQuery, [id, splitId], (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      return res.status(200).json({ message: 'Messages updated successfully for filtered path' });
    });
  } else {
    const checkQuery = `SELECT archived_users FROM users WHERE id = ?`;

    executeQuery(checkQuery, [splitId], (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      let archivedUsers = result[0].archived_users;

      if (!archivedUsers) {
        archivedUsers = [];
      } else {
        archivedUsers = JSON.parse(archivedUsers);
      }

      if (path === "inbox") {
        if (!archivedUsers.includes(id)) {
          archivedUsers.push(id);
        }
      } else if (path === "archive") {
        archivedUsers = archivedUsers.filter(userId => userId.toString() !== id.toString());
      }

      const updateQuery = `UPDATE users SET archived_users = ? WHERE id = ?`;
      executeQuery(updateQuery, [JSON.stringify(archivedUsers), splitId], (err, result) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        return res.status(200).json({ message: 'Archived users updated successfully' });
      });
    });
  }

};

export const saveBlockedUser = (req, res) => {
  const userid = req.params.id;

  const { id } = req.body;

  // Check for database connection and reconnect if needed
  if (db.state === "disconnected") {
    console.log("Database disconnected, reconnecting...");

    db.connect((err) => {
      if (err) {
        console.error("Failed to reconnect to the database:", err);
        return res.status(500).json({
          error: {
            message: "Failed to reconnect to the database.",
            details: err.message,
            code: err.code,
            stack: err.stack,
          },
        });
      }

      // Execute the query
      const checkQuery = `SELECT id, block_users FROM users WHERE id IN (?, ?)`;
      db.query(checkQuery, [userid, id], (err, result) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        let userBlockList = [];
        let selectedUserBlockList = [];

        if (result) {
          const user = result.find(item => item.id == userid);
          const selectedUser = result.find(item => item.id == id);

          userBlockList = user?.block_users ? JSON.parse(user.block_users) : [];
          selectedUserBlockList = selectedUser?.block_users ? JSON.parse(selectedUser.block_users) : [];
        }

        // Add each user to the other's block list, if not already blocked
        if (!userBlockList.includes(id)) {
          userBlockList.push(id);
        }
        if (!selectedUserBlockList.includes(userid)) {
          selectedUserBlockList.push(userid);
        }

        const updateQuery = `UPDATE users SET block_users = CASE 
                         WHEN id = ? THEN ? 
                         WHEN id = ? THEN ? 
                         END 
                         WHERE id IN (?, ?)`;

        db.query(
          updateQuery,
          [userid, JSON.stringify(userBlockList), id, JSON.stringify(selectedUserBlockList), userid, id],
          (err, result) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            return res.status(200).json({ message: 'Blocked users updated successfully' });
          }
        );
      });


    });
  } else {
    // Execute the query if the connection is active

    const checkQuery = `SELECT id, block_users FROM users WHERE id IN (?, ?)`;
    db.query(checkQuery, [userid, id], (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      let userBlockList = [];
      let selectedUserBlockList = [];

      if (result) {
        const user = result.find(item => item.id == userid);
        const selectedUser = result.find(item => item.id == id);

        userBlockList = user?.block_users ? JSON.parse(user.block_users) : [];
        selectedUserBlockList = selectedUser?.block_users ? JSON.parse(selectedUser.block_users) : [];
      }

      // Add each user to the other's block list, if not already blocked
      if (!userBlockList.includes(id)) {
        userBlockList.push(id);
      }
      if (!selectedUserBlockList.includes(userid)) {
        selectedUserBlockList.push(userid);
      }

      const updateQuery = `UPDATE users SET block_users = CASE 
                         WHEN id = ? THEN ? 
                         WHEN id = ? THEN ? 
                         END 
                         WHERE id IN (?, ?)`;

      db.query(
        updateQuery,
        [userid, JSON.stringify(userBlockList), id, JSON.stringify(selectedUserBlockList), userid, id],
        (err, result) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          return res.status(200).json({ message: 'Blocked users updated successfully' });
        }
      );
    });

  }
};

export const deleteConversation = (req, res) => {
  const userid = req.params.id;
  const { id: selectedUserId } = req.body;
  const currentTimestamp = new Date().toISOString();

  const userDetailQuery = `SELECT deleted_users FROM delete_user_conversation WHERE user_id = ?`;

  if (db.state === "disconnected") {
    console.log("Database disconnected, reconnecting...");

    db.connect((err) => {
      if (err) {
        console.error("Failed to reconnect to the database:", err);
        return res.status(500).json({
          error: {
            message: "Failed to reconnect to the database.",
            details: err.message,
            code: err.code,
            stack: err.stack,
          },
        });
      }
      // Execute the query
      db.query(userDetailQuery, [userid], (err, results) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        let deletedUsers = [];

        if (results?.length > 0 && results[0].deleted_users) {
          deletedUsers = JSON.parse(results[0].deleted_users);
          const userIndex = deletedUsers.findIndex(user => user.id.toString() === selectedUserId.toString());
          if (userIndex > -1) {
            deletedUsers[userIndex].timestamp = currentTimestamp;
          } else {
            deletedUsers.push({ id: selectedUserId, timestamp: currentTimestamp });
          }
        } else {
          deletedUsers.push({ id: selectedUserId, timestamp: currentTimestamp });
        }
        const updateQuery = `INSERT INTO delete_user_conversation (user_id, deleted_users) 
                             VALUES (?, ?) 
                             ON DUPLICATE KEY UPDATE deleted_users = ?`;

        db.query(updateQuery, [userid, JSON.stringify(deletedUsers), JSON.stringify(deletedUsers)], (err, result) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          return res.status(200).json({ message: 'Conversation deleted/updated successfully' });
        });
      });

    });
  } else {

    db.query(userDetailQuery, [userid], (err, results) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      let deletedUsers = [];

      if (results?.length > 0 && results[0].deleted_users) {
        deletedUsers = JSON.parse(results[0].deleted_users);
        const userIndex = deletedUsers.findIndex(user => user.id.toString() === selectedUserId.toString());
        if (userIndex > -1) {
          deletedUsers[userIndex].timestamp = currentTimestamp;
        } else {
          deletedUsers.push({ id: selectedUserId, timestamp: currentTimestamp });
        }
      } else {
        deletedUsers.push({ id: selectedUserId, timestamp: currentTimestamp });
      }
      const updateQuery = `INSERT INTO delete_user_conversation (user_id, deleted_users) 
                           VALUES (?, ?) 
                           ON DUPLICATE KEY UPDATE deleted_users = ?`;

      db.query(updateQuery, [userid, JSON.stringify(deletedUsers), JSON.stringify(deletedUsers)], (err, result) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        return res.status(200).json({ message: 'Conversation deleted/updated successfully' });
      });
    });

  }

};

export const restoreConversation = (req, res) => {
  const userid = req.params.id;
  const { id: selectedUserId, timestamp } = req.body;

  const userDetailQuery = `SELECT deleted_users FROM delete_user_conversation WHERE user_id = ?`;
  executeQuery(userDetailQuery, [userid], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    let deletedUsers = [];

    if (results?.length > 0 && results[0].deleted_users) {
      deletedUsers = JSON.parse(results[0].deleted_users);
      const userIndex = deletedUsers.findIndex(user => user.id.toString() === selectedUserId.toString());
      if (userIndex > -1 && timestamp) {
        deletedUsers[userIndex].timestamp = timestamp;
      } else {
        deletedUsers = deletedUsers.filter(user => user.id.toString() !== selectedUserId.toString())
      }
    }
    const updateQuery = `INSERT INTO delete_user_conversation (user_id, deleted_users) 
                         VALUES (?, ?) 
                         ON DUPLICATE KEY UPDATE deleted_users = ?`;

    executeQuery(updateQuery, [userid, JSON.stringify(deletedUsers), JSON.stringify(deletedUsers)], (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      return res.status(200).json({ message: 'Conversation restored/updated successfully' });
    });
  });
};


export const markAsUnread = (req, res) => {
  const messageId = req.params.id;
  const updateMessage = `UPDATE messages SET is_read = 1 WHERE id = ?`;

  executeQuery(updateMessage, [messageId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    return res.status(200).json({ message: 'updated successfully' });
  })
}

export const checkAuth = (req, res) => {
  const id = req.params.id;
  const { token } = req.body;
  const getToken = `SELECT token FROM loggedin WHERE userid = ?`;

  executeQuery(getToken, [id], (err, results) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (results?.length > 0) {
      let check = results[0]?.token;
      if (check && check === token) {
        return res.status(200).json({ message: 'successfully matched' });
      }
    }
    return res.status(201).json({ message: 'not matched' });
  })
}




