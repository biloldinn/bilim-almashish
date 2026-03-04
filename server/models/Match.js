const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
    teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    subject: {
        name: String,
        category: String
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'completed', 'rejected', 'cancelled'],
        default: 'pending'
    },
    startDate: {
        type: Date,
        default: Date.now
    },
    endDate: Date,
    sessions: [{
        date: Date,
        duration: Number,
        notes: String
    }],
    certificateIssued: {
        type: Boolean,
        default: false
    },
    certificateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Certificate'
    },
    teacherRating: {
        rating: Number,
        feedback: String,
        date: Date
    },
    studentRating: {
        rating: Number,
        feedback: String,
        date: Date
    }
});

module.exports = mongoose.model('Match', matchSchema);
