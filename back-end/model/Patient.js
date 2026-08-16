const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const PatientSchema = new Schema({
    patient_id: {
        type: String,
        required: true
    },
    age: {
        type: Number,
        required: true
    },
    gender: {
        type: String,
        required: true
    },
    weight: {
        type: String,
        required: false
    },
    height: {
        type: String,
        required: false
    },
    race: {
        type: String,
        required: true
    },
    underlying_condition: [{
        name: String,
        catch: Boolean
    }],
    warning_status: {
        status: {
            type: String,
            value: "Reviewed" || "Pending Review" || null,
            default: null
        },
        flags: [{
            top_contributors: [{
                name: String,
                contribution: Number
            }],
            flag_when: Date
        }]
    },
    readings: [{
        charttime: Date,
        imputed_share: Number,
        documentation_share: Number,
        sufficient_data: {
            type: String,
            enum: ["sufficient", "insufficient"]
        },
        risk_score: Number,
        risk_level: {
            type: String,
            enum: ["Critical", "High", "Medium", "Low"]
        },
        review_at: Date,
        top_contributors: [{
            name: String,
            contribution: Number
        }],
        parameters: [{
            name: String,
            value: Number,
            source: {
                type: String,
                enum: ["measured", "carried_forward", "population_reference"]
            },
            last_measured: Date
        }],
        explanation: {
            type: String,
            default: null
        },
        citations: [{
            name: String,
            claim: String
        }]
    }]
});

module.exports = mongoose.model('Patient', PatientSchema);
