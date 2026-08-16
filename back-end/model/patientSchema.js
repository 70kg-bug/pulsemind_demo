{
    patient_id : {
        type: String;
        require: true
    };
    age: {
        type: Number;
        require: true
    };
    gender: {
        type: String;
        require: true
    };
    weight: {
        type: String;
        require: false
    };
    height: {
        type: String;
        require: false
    };
    race: {
        type: String;
        require: true
    };
    warning_status: {
        status: "Reviewed" || "Pending Review" || null;
        flags: [{
            top_contributors: [{
                name: String,
                contribution: Number,
            }],
            flag_when: Date
        }];

    };
    underlying_condition: [{
                name: String,
                catch: Boolean
            }]
    readings: [
        {
            charttime: Date,
            imputed_share: Number,
            documentation_share: Number,
            sufficient_data: "sufficient" || "insufficient" ,
            risk_score: Number,
            risk_level: "Critical" || "High" || "Medium" || "Low",
            review_at: Date,
            top_contributors: [{
                name: String,
                contribution: Number,
            }],
            parameters: [{
                name: String,
                value: Number,
                source: "measured" || "carried_forward" || "population_reference",
                last_measured: Date
            }],
            explanation: String || null,
            citations: [{
                name: String,
                claim: String
            }] || null,
        }
    ]
}