const mongoose = require('mongoose');

const certificateSchema = new mongoose.Schema({
    certificateNumber: {
        type: String,
        required: true,
        unique: true
    },
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
    issueDate: {
        type: Date,
        default: Date.now
    },
    completionDate: Date,
    pdfPath: String,
    isAccepted: {
        type: Boolean,
        default: false
    },
    acceptedDate: Date
});

certificateSchema.pre('save', function (next) {
    if (!this.certificateNumber) {
        this.certificateNumber = 'CERT-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
    next();
});

module.exports = mongoose.model('Certificate', certificateSchema);
