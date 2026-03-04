const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const multer = require('multer');
const fs = require('fs');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Session configuration
const sessionStore = process.env.MONGODB_URI ? MongoStore.create({
    mongoUrl: process.env.MONGODB_URI
}) : new session.MemoryStore();

app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    store: sessionStore
}));

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath = 'public/uploads/';
        if (file.fieldname === 'profileImage') {
            uploadPath += 'profiles/';
        } else if (file.fieldname === 'chatImage') {
            uploadPath += 'chat/';
        } else if (file.fieldname === 'voiceMessage') {
            uploadPath += 'voice/';
        } else if (file.fieldname === 'videoMessage') {
            uploadPath += 'video/';
        }

        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    }
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected successfully'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// Models
const User = require('./models/User');
const Match = require('./models/Match');
const Certificate = require('./models/Certificate');

// Routes
app.post('/api/register', upload.single('profileImage'), async (req, res) => {
    try {
        const { firstName, lastName, phone, password, subjects } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({ error: 'Bu telefon raqam allaqachon ro\'yxatdan o\'tgan' });
        }

        // Parse subjects
        const parsedSubjects = JSON.parse(subjects);

        // Determine role based on subjects
        let role = 'student';
        const hasStrongSubject = parsedSubjects.some(s => s.level === 'strong');
        const hasWeakSubject = parsedSubjects.some(s => s.level === 'weak');

        if (hasStrongSubject && hasWeakSubject) {
            role = 'both';
        } else if (hasStrongSubject) {
            role = 'teacher';
        }

        // Create user
        const user = new User({
            firstName,
            lastName,
            phone,
            password,
            subjects: parsedSubjects,
            role,
            profileImage: req.file ? `/uploads/profiles/${req.file.filename}` : '/uploads/default-avatar.png'
        });

        await user.save();

        // Auto-match with teachers/students
        await autoMatchUsers(user);

        res.status(201).json({
            message: 'Ro\'yxatdan muvaffaqiyatli o\'tdingiz',
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone,
                role: user.role,
                profileImage: user.profileImage
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(401).json({ error: 'Telefon raqam yoki parol noto\'g\'ri' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Telefon raqam yoki parol noto\'g\'ri' });
        }

        user.isOnline = true;
        user.lastSeen = new Date();
        await user.save();

        req.session.userId = user._id;

        res.json({
            message: 'Muvaffaqiyatli kirdingiz',
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                phone: user.phone,
                role: user.role,
                profileImage: user.profileImage,
                subjects: user.subjects
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

app.post('/api/logout', async (req, res) => {
    if (req.session.userId) {
        await User.findByIdAndUpdate(req.session.userId, {
            isOnline: false,
            lastSeen: new Date()
        });
        req.session.destroy();
    }
    res.json({ message: 'Chiqish muvaffaqiyatli' });
});

// Auto-matching function
async function autoMatchUsers(newUser) {
    try {
        const weakSubjects = newUser.subjects.filter(s => s.level === 'weak');

        for (const weakSubject of weakSubjects) {
            // Find teachers for weak subjects
            const teachers = await User.find({
                _id: { $ne: newUser._id },
                'subjects': {
                    $elemMatch: {
                        name: weakSubject.name,
                        level: 'strong'
                    }
                },
                role: { $in: ['teacher', 'both'] }
            });

            for (const teacher of teachers) {
                // Check if match already exists
                const existingMatch = await Match.findOne({
                    teacher: teacher._id,
                    student: newUser._id,
                    subject: weakSubject
                });

                if (!existingMatch) {
                    const match = new Match({
                        teacher: teacher._id,
                        student: newUser._id,
                        subject: weakSubject,
                        status: 'pending'
                    });
                    await match.save();

                    // Notify teacher via socket
                    if (teacher.socketId) {
                        io.to(teacher.socketId).emit('new_match_request', {
                            matchId: match._id,
                            student: {
                                id: newUser._id,
                                firstName: newUser.firstName,
                                lastName: newUser.lastName,
                                profileImage: newUser.profileImage
                            },
                            subject: weakSubject
                        });
                    }
                }
            }
        }

        // If user has strong subjects, find weak students
        const strongSubjects = newUser.subjects.filter(s => s.level === 'strong');

        for (const strongSubject of strongSubjects) {
            const weakStudents = await User.find({
                _id: { $ne: newUser._id },
                'subjects': {
                    $elemMatch: {
                        name: strongSubject.name,
                        level: 'weak'
                    }
                }
            });

            for (const student of weakStudents) {
                const existingMatch = await Match.findOne({
                    teacher: newUser._id,
                    student: student._id,
                    subject: strongSubject
                });

                if (!existingMatch) {
                    const match = new Match({
                        teacher: newUser._id,
                        student: student._id,
                        subject: strongSubject,
                        status: 'pending'
                    });
                    await match.save();

                    // Notify student via socket
                    if (student.socketId) {
                        io.to(student.socketId).emit('new_teacher_offer', {
                            matchId: match._id,
                            teacher: {
                                id: newUser._id,
                                firstName: newUser.firstName,
                                lastName: newUser.lastName,
                                profileImage: newUser.profileImage
                            },
                            subject: strongSubject
                        });
                    }
                }
            }
        }
    } catch (error) {
        console.error('Auto-match error:', error);
    }
}

// Certificate generation
app.post('/api/generate-certificate', async (req, res) => {
    try {
        const { matchId, teacherId, studentId, subject } = req.body;

        const teacher = await User.findById(teacherId);
        const student = await User.findById(studentId);
        const match = await Match.findById(matchId);

        if (!teacher || !student || !match) {
            return res.status(404).json({ error: 'Ma\'lumotlar topilmadi' });
        }

        // Generate PDF
        const doc = new PDFDocument();
        const certificatePath = `public/uploads/certificates/cert-${Date.now()}.pdf`;

        if (!fs.existsSync('public/uploads/certificates')) {
            fs.mkdirSync('public/uploads/certificates', { recursive: true });
        }

        const writeStream = fs.createWriteStream(certificatePath);
        doc.pipe(writeStream);

        // Certificate design
        doc.rect(50, 50, 500, 700).stroke();

        doc.fontSize(30)
            .text('SERTIFIKAT', 200, 150, { align: 'center' });

        doc.fontSize(20)
            .text('Ushbu sertifikat', 200, 220, { align: 'center' });

        doc.fontSize(25)
            .text(`${student.firstName} ${student.lastName}`, 200, 280, { align: 'center' });

        doc.fontSize(18)
            .text(`${subject.name} fanini`, 200, 340, { align: 'center' });

        doc.fontSize(18)
            .text(`muvaffaqiyatli tamomlaganligini tasdiqlaydi`, 200, 380, { align: 'center' });

        doc.fontSize(16)
            .text(`O'qituvchi: ${teacher.firstName} ${teacher.lastName}`, 150, 450);

        doc.fontSize(14)
            .text(`Sana: ${new Date().toLocaleDateString('uz-UZ')}`, 150, 500);

        doc.fontSize(12)
            .text(`Sertifikat raqami: CERT-${Date.now()}`, 150, 550);

        doc.end();

        writeStream.on('finish', async () => {
            const certificate = new Certificate({
                teacher: teacherId,
                student: studentId,
                subject,
                pdfPath: certificatePath.replace('public', ''),
                completionDate: new Date()
            });

            await certificate.save();

            match.status = 'completed';
            match.certificateIssued = true;
            match.certificateId = certificate._id;
            match.endDate = new Date();
            await match.save();

            teacher.completedSessions += 1;
            await teacher.save();

            // Notify student
            if (student.socketId) {
                io.to(student.socketId).emit('certificate_issued', {
                    certificateId: certificate._id,
                    matchId: match._id,
                    pdfPath: certificate.pdfPath
                });
            }

            res.json({
                message: 'Sertifikat muvaffaqiyatli yaratildi',
                certificatePath: certificate.pdfPath
            });
        });
    } catch (error) {
        console.error('Certificate generation error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

// Accept certificate
app.post('/api/accept-certificate', async (req, res) => {
    try {
        const { certificateId } = req.body;

        const certificate = await Certificate.findById(certificateId);
        if (!certificate) {
            return res.status(404).json({ error: 'Sertifikat topilmadi' });
        }

        certificate.isAccepted = true;
        certificate.acceptedDate = new Date();
        await certificate.save();

        const match = await Match.findOne({ certificateId });
        if (match) {
            // Auto-match with next weak student
            const teacher = await User.findById(match.teacher);
            const subject = match.subject;

            const nextStudent = await User.findOne({
                _id: { $ne: match.student },
                'subjects': {
                    $elemMatch: {
                        name: subject.name,
                        level: 'weak'
                    }
                }
            });

            if (nextStudent) {
                const newMatch = new Match({
                    teacher: teacher._id,
                    student: nextStudent._id,
                    subject,
                    status: 'pending'
                });
                await newMatch.save();

                if (nextStudent.socketId) {
                    io.to(nextStudent.socketId).emit('new_teacher_offer', {
                        matchId: newMatch._id,
                        teacher: {
                            id: teacher._id,
                            firstName: teacher.firstName,
                            lastName: teacher.lastName,
                            profileImage: teacher.profileImage
                        },
                        subject
                    });
                }
            }
        }

        res.json({ message: 'Sertifikat qabul qilindi' });
    } catch (error) {
        console.error('Accept certificate error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

// Reject match
app.post('/api/reject-match', async (req, res) => {
    try {
        const { matchId } = req.body;

        const match = await Match.findByIdAndUpdate(matchId, {
            status: 'rejected'
        });

        res.json({ message: 'So\'rov rad etildi' });
    } catch (error) {
        console.error('Reject match error:', error);
        res.status(500).json({ error: 'Server xatosi' });
    }
});

// Socket.IO for real-time chat
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('user_online', async (userId) => {
        await User.findByIdAndUpdate(userId, {
            isOnline: true,
            socketId: socket.id
        });
        socket.join(userId);
        io.emit('user_status_change', { userId, isOnline: true });
    });

    socket.on('send_message', async (data) => {
        const { senderId, receiverId, message, type, fileUrl } = data;

        const messageData = {
            senderId,
            message,
            type: type || 'text',
            fileUrl,
            timestamp: new Date()
        };

        io.to(receiverId).emit('receive_message', messageData);

        // Save message to database if needed
    });

    socket.on('send_location', async (data) => {
        const { senderId, receiverId, location } = data;

        io.to(receiverId).emit('receive_location', {
            senderId,
            location,
            timestamp: new Date()
        });
    });

    socket.on('typing', (data) => {
        const { senderId, receiverId, isTyping } = data;
        io.to(receiverId).emit('user_typing', { senderId, isTyping });
    });

    socket.on('disconnect', async () => {
        await User.findOneAndUpdate(
            { socketId: socket.id },
            { isOnline: false, lastSeen: new Date() }
        );
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});
