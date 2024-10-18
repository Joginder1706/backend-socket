import express from "express";
import {
  checkAuth,
  deleteConversation,
  getArchiveMessages,
  getCategories,
  getFilteredMessages,
  getInboxMessages,
  getSentMessages,
  getSingleUserMessage,
  getUserById,
  markAsUnread,
  postFilterData,
  restoreConversation,
  saveArchivedUser,
  saveBlockedUser,
} from "../controller/userController.js";
const router = express.Router();
router.get("/inbox", getInboxMessages);
router.get("/filtered", getFilteredMessages);
router.get("/user/:id", getUserById);
router.get("/sent", getSentMessages);
router.get("/messages/:id1/:id2", getSingleUserMessage);
router.get("/cats/:id", getCategories);
router.post("/filter-data/:id", postFilterData);
router.get("/archive", getArchiveMessages);
router.post("/archive/:id", saveArchivedUser);
router.post("/block-user/:id", saveBlockedUser);
router.post("/delete-conversation/:id", deleteConversation)
router.post("/restore-conversation/:id", restoreConversation)
router.put("/mark-as-unread/:id", markAsUnread)
router.post("/auth/:id", checkAuth)
export default router;
