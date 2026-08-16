const Patient = require('../model/Patient');
const axios = require('axios')

// data -> back-end -> db -> front-end

const getPatientInfo = async (req, res) => {
    if (!req?.params?.id) return res.status(400).json({ 'message': 'Patient ID required.' });

    const patient = await Patient.findOne({ _id: req.params.id }).exec();
    if (!patient) {
        return res.status(204).json({ "message": `No patient matches ID ${req.params.id}.` });
    }
    patientInfo = {
        patient_id: patient.patient_id,
        age: patient.age,
        gender: patient.gender,
        weight: patient.weight,
        height: patient.height,
        race: patient.race,
        underlying_condition: patient.underlying_condition
    }
    res.json(patientInfo);
}

const getWarning = async (req, res) => {
    if (!req?.params?.id) return res.status(400).json({ 'message': 'Patient ID required.' });

    const patient = await Patient.findOne({ _id: req.params.id }).exec();
    if (!patient) {
        return res.status(204).json({ "message": `No patient matches ID ${req.params.id}.` });
    }
    res.json(patient.warning_status);
}

const getPatientReading = async (req, res) => {
    if (!req?.params?.id) return res.status(400).json({ 'message': 'Patient ID required.' });

    const patient = await Patient.findOne({ _id: req.params.id }).exec();
    if (!patient) {
        return res.status(204).json({ "message": `No patient matches ID ${req.params.id}.` });
    }
    res.json(patient.readings);
}

const getAllPatient = async (req, res) => {
    const patients = await Patientatient.find();
    if (!patients) return res.status(204).json({ 'message': 'No patients found.' });
    res.json(patients);
}

const create100NewPatient = async (req, res) => {
    for (let i = 0; i < 100; i++){
        const response = await axios.get(`http://127.0.0.1:8000/data/${i}`);

        const {
            patient_id,
            age,
            gender,
            weight,
            height,
            race,
            underlying_condition,
            warning_status,
            readings
        } = response


        try {
            const result = await Patient.create({
                patient_id: patient_id,
                age: age,
                gender: gender,
                weight: weight,
                height: height,
                race: race,
                underlying_condition: underlying_condition,
                warning_status: warning_status,
                readings: readings
            });

            res.status(201).json(result);
        } catch (err) {
            console.error(err);
        }
    }
}

// const updateEmployee = async (req, res) => {
//     if (!req?.body?.id) {
//         return res.status(400).json({ 'message': 'ID parameter is required.' });
//     }

//     const employee = await Employee.findOne({ _id: req.body.id }).exec();
//     if (!employee) {
//         return res.status(204).json({ "message": `No employee matches ID ${req.body.id}.` });
//     }
//     if (req.body?.firstname) employee.firstname = req.body.firstname;
//     if (req.body?.lastname) employee.lastname = req.body.lastname;
//     const result = await employee.save();
//     res.json(result);
// }

// const deleteEmployee = async (req, res) => {
//     if (!req?.body?.id) return res.status(400).json({ 'message': 'Employee ID required.' });

//     const employee = await Employee.findOne({ _id: req.body.id }).exec();
//     if (!employee) {
//         return res.status(204).json({ "message": `No employee matches ID ${req.body.id}.` });
//     }
//     const result = await employee.deleteOne(); //{ _id: req.body.id }
//     res.json(result);
// }


module.exports = {
    getAllPatient,
    getPatientInfo,
    getPatientReading,
    getWarning,
    createNewPatient
}