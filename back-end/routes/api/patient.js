const express = require('express');
const router = express.Router();
const patientController = require('../../controllers/patientController');
// const ROLES_LIST = require('../../config/roles_list');
// const verifyRoles = require('../../middleware/verifyRoles');

router.route('/info/:patient_id')
    .get(patientController.getPatientInfo)

router.route('/warning/:patient_id')
    .get(patientController.getWarning)

router.route('/reading/:patient_id')
    .get(patientController.getPatientReading)

router.route('/reading/:patient_id')
    .post(patientController.createNewPatient)
module.exports = router;