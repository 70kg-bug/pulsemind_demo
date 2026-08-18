const express = require('express');
const router = express.Router();
const assessmentController = require('../../controllers/assessmentController');
const asyncHandler = require('../../middleware/asyncHandler');
const h = asyncHandler;

// Reads are served from MongoDB alone; only the two ward operations and the
// explanation reach the model service.
//
// No auth guard yet. SR001 and SR005 require RBAC before a clinician sees a
// prompt, and its absence is a listed blocker before any pilot. verifyJWT and
// verifyRoles exist in middleware/ and are deliberately NOT mounted -- an
// unmounted guard is visible, a permissive one is not.

// Every handler is async and touches the database -- see middleware/asyncHandler.
router.get('/ward', h(assessmentController.getWard));
router.post('/ward/seed', h(assessmentController.seedWard));
router.post('/ward/tick', h(assessmentController.tickWard));

router.get('/patient/:patientId', h(assessmentController.getPatient));
router.get('/patient/:patientId/history', h(assessmentController.getHistory));
router.get('/patient/:patientId/context', h(assessmentController.getPatientContext));
router.get('/patient/:patientId/parameter/:parameterName',
  h(assessmentController.getParameterHistory));

router.post('/patient/:patientId/explain', h(assessmentController.explainPatient));
router.post('/patient/:patientId/device', h(assessmentController.setDeviceState));

router.post('/prompt/:promptId/review', h(assessmentController.reviewPrompt));

module.exports = router;
