const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true,
        trim: true
    },
    lastName: {
        type: String,
        required: true,
        trim: true
    },
    phone: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    password: {
        type: String,
        required: true
    },
    profileImage: {
        type: String,
        default: '/uploads/default-avatar.png'
    },
    role: {
        type: String,
        enum: ['student', 'teacher', 'both'],
        default: 'student'
    },
    subjects: [{
        name: {
            type: String,
            required: true
        },
        category: {
            type: String,
            enum: ['matematika', 'fizika', 'kimyo', 'biologiya', 'ingliz_tili', 'tarix', 'geografiya', 'informatika', 'ona_tili', 'adabiyot', 'boshqa'],
            default: 'boshqa'
        },
        level: {
            type: String,
            enum: ['weak', 'medium', 'strong'],
            required: true
        },
        customSubject: {
            type: String,
            trim: true
        }
    }],
    location: {
        city: String,
        district: String,
        coordinates: {
            lat: Number,
            lng: Number
        }
    },
    bio: {
        type: String,
        maxLength: 500
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    lastSeen: {
        type: Date,
        default: Date.now
    },
    socketId: String,
    certificates: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Certificate'
    }],
    matches: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Match'
    }],
    rating: {
        type: Number,
        min: 0,
        max: 5,
        default: 0
    },
    completedSessions: {
        type: Number,
        default: 0
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
