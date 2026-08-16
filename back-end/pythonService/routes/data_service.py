from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn
import pandas as pd

app = FastAPI()

data = pd.read_csv('data.csv')

underlying_conditions_names = [
    "myocardial_infarct",
    "congestive_heart_failure",
    "peripheral_vascular_disease",
    "cerebrovascular_disease",
    "dementia",
    "chronic_pulmonary_disease",
    "rheumatic_disease",
    "peptic_ulcer_disease",
    "mild_liver_disease",
    "severe_liver_disease",
    "diabetes_without_cc",
    "diabetes_with_cc",
    "paraplegia",
    "renal_disease",
    "malignant_cancer",
    "metastatic_solid_tumor",
    "aids"
]

parameter_names = [
    "spo2",
    "fio2",
    "flow_rate",
    "peep",
    "pip",
    "respiratory_rate_total",
    "minute_volume",
    "tidal_volume_observed",
    "etco2",
    "inspiratory_ratio",
    "expiratory_ratio"
]

class InferenceInput(BaseModel):
    patient_id: str;
    age: int;
    gender: str;
    weight: str;
    height: str;
    race: str;
    underlying_condition: list[dict];
    warning_status: dict;
    readings: list

# Load your model once at startup
# model = load_my_model()



@app.get("/data/{i}")
def predict(payload: InferenceInput, i: int):
    payload.patient_id = data.iloc[i].patient_id
    
    payload.age = data.iloc[i].age
    
    payload.gender = data.iloc[i].gender
    
    payload.weight = data.iloc[i].weight
    
    payload.height = data.iloc[i].height
    
    payload.race = data.iloc[i].race
    
    underlying_conditions = []
    for name in underlying_conditions_names:
        condition = {
            "name": name,
            "catch": data.iloc[i].name
        }
        underlying_conditions.append(condition)
    payload.underlying_condition = underlying_conditions
    
    payload.warning_status = {
        "status": None,
        "flags": [
            {
                "top_contributor": [
                    {
                        "name": "",
                        "contribution": ""
                    }
                ],
                "flag_when": ""
            }
        ]
    }
    
    readings = [
        {
            "chattime": "",
            "imputed_share": "",
            "documentation_share": "",
            "sufficient_data": "",
            "risk_score": "",
            "risk_level": "",
            "review_at": "",
            "top_contributors": [
                {
                    "name": "",
                    "contribution": "",
                }
            ],
            "parameters": [
                {
                    "name": name,
                    "value": data.iloc[i].name,
                    "source": "",
                    "last_measured": "",
                }
                
                for name in parameter_names
            ],
            "explanation": "",
            "citations": ""
        }
    ]
    payload.readings = readings
    return {"prediction": f"Processed: {payload}"}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)