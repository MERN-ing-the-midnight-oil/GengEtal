import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  addFriendFromGalleryLink,
  ensureFriendImage,
  getAllFriendsGalleries,
  getFriendGallery,
  listFriends,
  removeFriend,
} from '../services/friends.js';
import { getMyGalleryShareInfo } from '../services/gallery.js';
import { isAuthenticated, isDriveConfigured } from '../services/drive.js';
import { config } from '../config.js';

const router = express.Router();

router.get('/me', async (_req, res) => {
  try {
    if (!isDriveConfigured() || !isAuthenticated()) {
      return res.status(401).json({ error: 'Sign in with Google first' });
    }
    const share = await getMyGalleryShareInfo();
    res.json({ share });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/', (_req, res) => {
  res.json({ friends: listFriends() });
});

router.post('/', async (req, res) => {
  try {
    const link = String(req.body?.galleryLink || req.body?.link || '').trim();
    if (!link) {
      return res.status(400).json({ error: 'galleryLink is required' });
    }
    const friend = await addFriendFromGalleryLink(link);
    res.status(201).json({ friend, friends: listFriends() });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

router.get('/gallery', async (_req, res) => {
  try {
    const data = await getAllFriendsGalleries();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:friendId', (req, res) => {
  const result = removeFriend(req.params.friendId);
  if (!result) return res.status(404).json({ error: 'Friend not found' });
  res.json({ ok: true, friends: listFriends() });
});

router.get('/:friendId/gallery', async (req, res) => {
  try {
    const gallery = await getFriendGallery(req.params.friendId);
    res.json(gallery);
  } catch (err) {
    const status = /not found/i.test(err.message) ? 404 : 502;
    res.status(status).json({ error: err.message });
  }
});

router.get('/:friendId/images/:jobId', async (req, res) => {
  try {
    const imagePath = await ensureFriendImage(
      req.params.friendId,
      req.params.jobId
    );
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Image not available' });
    }
    if (fs.statSync(imagePath).size < config.minResultImageBytes) {
      return res.status(404).json({ error: 'Image not available' });
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.resolve(imagePath));
  } catch (err) {
    console.error(err);
    const status = /not found/i.test(err.message) ? 404 : 502;
    res.status(status).json({ error: err.message });
  }
});

export default router;
