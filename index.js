import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(helmet());
app.use(express.json());

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Middleware
const auth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Auth Routes
const RegisterSchema = z.object({
  username: z.string().min(3),
  email: z.string().email().optional(),
  password: z.string().min(6),
});

app.post('/auth/register', async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  
  const { username, email, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);
  
  try {
    const user = await prisma.user.create({
      data: { username, email, passwordHash }
    });
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    res.status(400).json({ error: 'Username or email already exists' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: usernameOrEmail }, { email: usernameOrEmail }] }
  });
  
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username } });
});

// Feed & Posts
app.get('/feed', auth, async (req, res) => {
  const cursor = req.query.cursor;
  const posts = await prisma.post.findMany({
    take: 10,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      author: { select: { id: true, username: true, avatarUrl: true } },
      _count: { select: { likes: true, comments: true } },
      likes: { where: { userId: req.userId }, select: { userId: true } }
    }
  });
  
  const nextCursor = posts.length === 10 ? posts[posts.length - 1].id : null;
  res.json({
    items: posts.map(p => ({
      ...p,
      counts: p._count,
      liked: p.likes.length > 0
    })),
    nextCursor
  });
});

app.post('/posts', auth, async (req, res) => {
  const { content, poemType, imageUrl } = req.body;
  const post = await prisma.post.create({
    data: { content, poemType, imageUrl, authorId: req.userId },
    include: { author: { select: { id: true, username: true } } }
  });
  res.json(post);
});

// Comments
app.get("/posts/:id/comments", auth, async (req, res) => {
  const postId = req.params.id;
  const comments = await prisma.comment.findMany({
    where: { postId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, username: true, avatarUrl: true } } }
  });
  res.json(comments);
});

app.post("/posts/:id/comments", auth, async (req, res) => {
  const postId = req.params.id;
  const { text } = req.body;
  const comment = await prisma.comment.create({
    data: { text, postId, userId: req.userId },
    include: { author: { select: { id: true, username: true, avatarUrl: true } } }
  });
  res.json(comment);
});

// Likes
app.post("/posts/:id/like", auth, async (req, res) => {
  try {
    await prisma.like.create({ data: { postId: req.params.id, userId: req.userId } });
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: 'Already liked' }); }
});

app.delete("/posts/:id/like", auth, async (req, res) => {
  await prisma.like.deleteMany({ where: { postId: req.params.id, userId: req.userId } });
  res.json({ success: true });
});

// Search
app.get("/users/search", auth, async (req, res) => {
  const q = String(req.query.q || "");
  if (!q) return res.json([]);
  const users = await prisma.user.findMany({
    where: { username: { contains: q, mode: "insensitive" } },
    take: 20,
    select: { id: true, username: true, avatarUrl: true }
  });
  const following = await prisma.follow.findMany({
    where: { followerId: req.userId, followingId: { in: users.map(u => u.id) } },
    select: { followingId: true }
  });
  const set = new Set(following.map(f => f.followingId));
  res.json(users.map(u => ({ ...u, isFollowing: set.has(u.id) })));
});

// Profile
app.get('/me', auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  res.json(user);
});

const UpdateMeSchema = z.object({
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().nullable().optional()
});

app.patch("/me", auth, async (req, res) => {
  const parsed = UpdateMeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error);
  const me = await prisma.user.update({ where: { id: req.userId }, data: parsed.data });
  res.json({ id: me.id, username: me.username, bio: me.bio, avatarUrl: me.avatarUrl });
});

app.get("/users/:id/posts", auth, async (req, res) => {
  const userId = req.params.id;
  const posts = await prisma.post.findMany({
    where: { authorId: userId, published: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(req.query.limit) || 20, 50),
    include: {
      author: { select: { id: true, username: true, avatarUrl: true } },
      _count: { select: { likes: true, comments: true } },
      likes: { where: { userId: req.userId }, select: { userId: true } }
    }
  });
  res.json(posts.map(p => ({
    id: p.id, content: p.content, title: p.title, imageUrl: p.imageUrl, audioUrl: p.audioUrl, videoUrl: p.videoUrl,
    createdAt: p.createdAt, author: p.author, counts: p._count, liked: p.likes.length > 0
  })));
});

// Upload
app.get('/upload/presign', auth, async (req, res) => {
  const { type, ext } = req.query;
  const key = `uploads/${req.userId}/${Date.now()}.${ext || 'jpg'}`;
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    ContentType: type === 'video' ? 'video/mp4' : 'image/jpeg',
  });
  
  const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
  res.json({
    url,
    publicUrl: `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${key}`,
    contentType: type === 'video' ? 'video/mp4' : 'image/jpeg'
  });
});

// Stories
app.get('/stories', auth, async (req, res) => {
  const stories = await prisma.story.findMany({
    where: { expiresAt: { gt: new Date() } },
    include: { author: { select: { id: true, username: true, avatarUrl: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json(stories);
});

app.post('/stories', auth, async (req, res) => {
  const { mediaUrl, mediaType } = req.body;
  const story = await prisma.story.create({
    data: {
      mediaUrl,
      mediaType,
      authorId: req.userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
    }
  });
  res.json(story);
});

// Notifications
app.get('/notifications', auth, async (req, res) => {
  const notifs = await prisma.notification.findMany({
    where: { userId: req.userId },
    include: { actor: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' }
  });
  res.json(notifs);
});

// Follow
app.post("/users/:id/follow", auth, async (req, res) => {
  try {
    await prisma.follow.create({ data: { followerId: req.userId, followingId: req.params.id } });
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: 'Already following' }); }
});

app.delete("/users/:id/follow", auth, async (req, res) => {
  await prisma.follow.deleteMany({ where: { followerId: req.userId, followingId: req.params.id } });
  res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
