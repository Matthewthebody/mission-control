import type {
  EmployeeAcknowledgementState,
  EmployeeCheckpointResult,
  EmployeeTrainingModuleProgress,
  EmployeeTrainingProfile,
  TrainingAcknowledgement,
  TrainingDashboardSnapshot,
  TrainingEmployeeSummary,
  TrainingModule,
  TrainingQuizAttempt,
  TrainingQuizQuestion,
  TrainingQuizRound
} from "../types/training.js";

export const trainingWorkbook = {
  id: "workbook-school-photographer",
  title: "School Photographer Workbook",
  summary: "Operational readiness training for Kemmetmueller school photography teams, from prep and guest experience to technical consistency and clean closeout.",
  version: "2026.1",
  updated_at: "2026-03-20T18:00:00.000Z",
  sections: [
    {
      id: "company-standards",
      title: "Company Standards",
      summary: "How Kemmetmueller shows up, communicates, and protects the guest experience before the first frame.",
      sort_order: 1,
      module_ids: ["module-company-standards"]
    },
    {
      id: "pre-shoot-preparation",
      title: "Pre-Shoot Preparation",
      summary: "Prep routines that keep picture day calm, complete, and ready to scale.",
      sort_order: 2,
      module_ids: ["module-pre-shoot-prep"]
    },
    {
      id: "equipment-setup",
      title: "Equipment Setup",
      summary: "Reliable setup sequencing, safety checks, and backup discipline before students arrive.",
      sort_order: 3,
      module_ids: ["module-equipment-setup"]
    },
    {
      id: "school-day-flow",
      title: "School Day Flow",
      summary: "Line flow, staff communication, and how to keep the day moving without losing warmth.",
      sort_order: 4,
      module_ids: ["module-school-day-flow"]
    },
    {
      id: "student-interaction",
      title: "Student Interaction",
      summary: "Confident direction, age-appropriate language, and keeping each family encounter professional.",
      sort_order: 5,
      module_ids: ["module-student-interaction"]
    },
    {
      id: "pose-expression-basics",
      title: "Pose and Expression Basics",
      summary: "Fast posing adjustments that protect quality even when the line is moving.",
      sort_order: 6,
      module_ids: ["module-pose-expression"]
    },
    {
      id: "lighting-camera-standards",
      title: "Lighting and Camera Standards",
      summary: "The technical baseline that keeps a Kemmetmueller day usable, consistent, and reviewable.",
      sort_order: 7,
      module_ids: ["module-lighting-camera"]
    },
    {
      id: "data-roster-accuracy",
      title: "Data / Roster Accuracy",
      summary: "Roster discipline, student matching, and how to avoid expensive downstream corrections.",
      sort_order: 8,
      module_ids: ["module-data-roster"]
    },
    {
      id: "troubleshooting-picture-day",
      title: "Troubleshooting on Picture Day",
      summary: "Escalation judgement, field recovery, and knowing when to ask for help early.",
      sort_order: 9,
      module_ids: ["module-troubleshooting"]
    },
    {
      id: "post-shoot-wrap-up",
      title: "Post-Shoot Wrap-Up",
      summary: "Closing the day cleanly so data, gear, and client trust all make it home together.",
      sort_order: 10,
      module_ids: ["module-post-shoot-wrap"]
    }
  ]
};

export const trainingModules: TrainingModule[] = [
  {
    id: "module-company-standards",
    section_id: "company-standards",
    title: "What Great Looks Like on Picture Day",
    summary: "Kemmetmueller service standards, communication tone, and why leadership wants predictable hospitality in the field.",
    estimated_minutes: 18,
    required: true,
    signoff_required: false,
    last_updated: "2026-03-18T15:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-arrival-standards"],
    acknowledgement_ids: ["ack-greeting-standard"],
    question_ids: ["q-greet-school", "q-family-tone", "q-line-reset"]
  },
  {
    id: "module-pre-shoot-prep",
    section_id: "pre-shoot-preparation",
    title: "Pre-Shoot Prep and Gear Readiness",
    summary: "Travel timing, pre-flight checks, and what has to be confirmed before the van door opens.",
    estimated_minutes: 16,
    required: true,
    signoff_required: false,
    last_updated: "2026-03-12T18:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-gear-preflight"],
    acknowledgement_ids: ["ack-vehicle-check"],
    question_ids: ["q-battery-check", "q-traffic-call", "q-backup-kit"]
  },
  {
    id: "module-equipment-setup",
    section_id: "equipment-setup",
    title: "Equipment Setup and Safety",
    summary: "How to get lights, backdrop, tethering, and flow markers ready without making the school regret hosting us.",
    estimated_minutes: 24,
    required: true,
    signoff_required: true,
    last_updated: "2026-03-10T20:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-setup-safety", "checkpoint-test-frame"],
    acknowledgement_ids: ["ack-safety-standard"],
    question_ids: ["q-weights-first", "q-test-frame", "q-cable-lane"]
  },
  {
    id: "module-school-day-flow",
    section_id: "school-day-flow",
    title: "Running the School Day Flow",
    summary: "Student throughput, teacher coordination, and how to protect both pace and warmth when the gym fills up.",
    estimated_minutes: 22,
    required: true,
    signoff_required: true,
    last_updated: "2026-03-18T13:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-lane-command"],
    acknowledgement_ids: ["ack-roster-escalation"],
    question_ids: ["q-line-pause", "q-teacher-queue", "q-late-classroom"]
  },
  {
    id: "module-student-interaction",
    section_id: "student-interaction",
    title: "Student Interaction and Hospitality",
    summary: "Age-appropriate prompts, warm authority, and keeping picture day kind even when the line is behind.",
    estimated_minutes: 14,
    required: true,
    signoff_required: false,
    last_updated: "2026-03-17T10:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-student-tone"],
    acknowledgement_ids: ["ack-student-comfort"],
    question_ids: ["q-nervous-kindergartner", "q-athlete-energy", "q-parent-observer"]
  },
  {
    id: "module-pose-expression",
    section_id: "pose-expression-basics",
    title: "Pose and Expression Basics",
    summary: "Fast corrections that lift quality without slowing the lane.",
    estimated_minutes: 12,
    required: false,
    signoff_required: false,
    last_updated: "2026-03-14T11:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-expression-basics"],
    acknowledgement_ids: ["ack-pose-consistency"],
    question_ids: ["q-chin-angle", "q-shoulder-fix"]
  },
  {
    id: "module-lighting-camera",
    section_id: "lighting-camera-standards",
    title: "Lighting and Camera Standards",
    summary: "Exposure, white balance, and camera discipline that keep the day shippable.",
    estimated_minutes: 26,
    required: true,
    signoff_required: true,
    last_updated: "2026-03-19T16:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-exposure-standard", "checkpoint-white-balance"],
    acknowledgement_ids: ["ack-camera-standard"],
    question_ids: ["q-histogram", "q-white-balance", "q-battery-rotation"]
  },
  {
    id: "module-data-roster",
    section_id: "data-roster-accuracy",
    title: "Data and Roster Accuracy",
    summary: "Protecting names, packages, and downstream production from avoidable field mistakes.",
    estimated_minutes: 18,
    required: true,
    signoff_required: false,
    last_updated: "2026-03-15T09:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-roster-audit"],
    acknowledgement_ids: ["ack-data-care"],
    question_ids: ["q-duplicate-name", "q-missing-roster", "q-package-mismatch"]
  },
  {
    id: "module-troubleshooting",
    section_id: "troubleshooting-picture-day",
    title: "Troubleshooting on Picture Day",
    summary: "What to fix alone, what to escalate, and how to buy time without losing trust.",
    estimated_minutes: 20,
    required: true,
    signoff_required: false,
    last_updated: "2026-03-16T12:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-escalation-judgment"],
    acknowledgement_ids: ["ack-escalation-window"],
    question_ids: ["q-escalate-early", "q-spare-body", "q-gym-relocation"]
  },
  {
    id: "module-post-shoot-wrap",
    section_id: "post-shoot-wrap-up",
    title: "Post-Shoot Wrap-Up",
    summary: "Gear check, data handoff, notes, and leaving the site cleaner than we found it.",
    estimated_minutes: 15,
    required: true,
    signoff_required: false,
    last_updated: "2026-03-20T08:00:00.000Z",
    version: "2026.1",
    content_blocks: [],
    checkpoint_ids: ["checkpoint-wrap-discipline"],
    acknowledgement_ids: ["ack-client-closeout"],
    question_ids: ["q-card-check", "q-left-behind", "q-client-followup"]
  }
];

export const trainingAcknowledgements: TrainingAcknowledgement[] = [
  { id: "ack-greeting-standard", module_id: "module-company-standards", title: "Greeting standard", summary: "I understand that family warmth and school-partner professionalism are part of the job standard." },
  { id: "ack-vehicle-check", module_id: "module-pre-shoot-prep", title: "Vehicle and gear check", summary: "I will not depart without confirming batteries, cards, signage, and the backup kit." },
  { id: "ack-safety-standard", module_id: "module-equipment-setup", title: "Setup safety", summary: "I will weight stands, protect walking lanes, and stop a setup that feels unsafe." },
  { id: "ack-roster-escalation", module_id: "module-school-day-flow", title: "Roster escalation", summary: "I will pause cleanly and escalate roster confusion instead of guessing student data." },
  { id: "ack-student-comfort", module_id: "module-student-interaction", title: "Student comfort", summary: "I understand how Kemmetmueller balances throughput with a calm student experience." },
  { id: "ack-pose-consistency", module_id: "module-pose-expression", title: "Pose consistency", summary: "I will use the approved expression cues instead of improvising a new style on a live school day." },
  { id: "ack-camera-standard", module_id: "module-lighting-camera", title: "Camera standard", summary: "I understand the exposure and white-balance baseline expected on every school shoot." },
  { id: "ack-data-care", module_id: "module-data-roster", title: "Roster care", summary: "I will protect student identity and package data with the same seriousness as image quality." },
  { id: "ack-escalation-window", module_id: "module-troubleshooting", title: "Escalation timing", summary: "I will escalate equipment or flow problems early enough for leadership to help." },
  { id: "ack-client-closeout", module_id: "module-post-shoot-wrap", title: "Client closeout", summary: "I understand the close-out expectations before leaving a school site." }
];

export const moduleIndex = new Map(trainingModules.map((module) => [module.id, module]));
export const questionBank: TrainingQuizQuestion[] = [
  {
    id: "q-greet-school",
    module_id: "module-company-standards",
    roles: ["associate_photographer", "senior_photographer", "leadership"],
    prompt: "You arrive on time, but the front office looks overwhelmed. What should happen first?",
    scenario: "The building is already busy and the office staff does not remember your arrival window.",
    choices: [
      { id: "q-greet-school-a", label: "Introduce yourself, confirm the school contact, and restate the plan calmly.", correct: true, explanation: "Kemmetmueller wants calm, visible leadership before gear takes over the space." },
      { id: "q-greet-school-b", label: "Start unloading immediately so you do not lose setup time.", correct: false, explanation: "Setup speed does not come before contact clarity." },
      { id: "q-greet-school-c", label: "Text leadership and wait in the parking lot for instructions.", correct: false, explanation: "Leadership should be informed only after you have tried the expected on-site greeting flow." }
    ]
  },
  {
    id: "q-family-tone",
    module_id: "module-company-standards",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "A parent asks if the line is behind before you have exact timing. What is the best reply?",
    scenario: "You need to keep confidence high without making up facts.",
    choices: [
      { id: "q-family-tone-a", label: "Acknowledge the question, share the current estimate, and promise an update if that changes.", correct: true, explanation: "Clear, warm estimates build trust better than vague reassurance." },
      { id: "q-family-tone-b", label: "Tell them not to worry because the team always catches up.", correct: false, explanation: "That promise can create a second trust problem if the line slips." },
      { id: "q-family-tone-c", label: "Send them to the front office because line pacing is not your role.", correct: false, explanation: "Field teams own the guest experience in the moment." }
    ]
  },
  {
    id: "q-line-reset",
    module_id: "module-company-standards",
    roles: ["senior_photographer", "leadership"],
    prompt: "The line energy is getting tense. What is the highest-value reset?",
    scenario: "Families can feel the stress before anyone says it out loud.",
    choices: [
      { id: "q-line-reset-a", label: "Pause, restate the lane plan, and give one clear next-step message.", correct: true, explanation: "A short visible reset protects both throughput and confidence." },
      { id: "q-line-reset-b", label: "Move faster and stop talking until the line shortens.", correct: false, explanation: "Silence often makes the stress feel worse." },
      { id: "q-line-reset-c", label: "Ask the school to clear the hallway completely.", correct: false, explanation: "That is too heavy-handed for a normal pacing dip." }
    ]
  },
  {
    id: "q-battery-check",
    module_id: "module-pre-shoot-prep",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "Which prep miss is most likely to create a same-day clock-in exception later?",
    scenario: "You are trying to think like operations, not just photography.",
    choices: [
      { id: "q-battery-check-a", label: "Leaving without verifying charged batteries and a backup body path.", correct: true, explanation: "A gear failure can delay start time and create avoidable operational fallout." },
      { id: "q-battery-check-b", label: "Packing two extra posing stools.", correct: false, explanation: "Helpful, but not a top readiness risk." },
      { id: "q-battery-check-c", label: "Skipping an optional team text before departure.", correct: false, explanation: "Nice to have, not the most operationally risky miss." }
    ]
  },
  {
    id: "q-traffic-call",
    module_id: "module-pre-shoot-prep",
    roles: ["senior_photographer", "leadership"],
    prompt: "Traffic risk jumps and your current buffer looks thin. What does leadership want?",
    scenario: "You still have a chance to leave early enough to recover.",
    choices: [
      { id: "q-traffic-call-a", label: "Call the adjustment early and update the team before it becomes late.", correct: true, explanation: "Operational maturity means treating risk early, not narrating it after the miss." },
      { id: "q-traffic-call-b", label: "Stay with the original plan so the day does not feel over-managed.", correct: false, explanation: "Late starts cost more than early communication." },
      { id: "q-traffic-call-c", label: "Wait for leadership to notice the traffic trend and call you first.", correct: false, explanation: "Field leads are expected to act on visible risk." }
    ]
  },
  {
    id: "q-backup-kit",
    module_id: "module-pre-shoot-prep",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "What belongs in the backup kit mindset?",
    scenario: "The day should still survive one normal equipment surprise.",
    choices: [
      { id: "q-backup-kit-a", label: "Anything the team would need to keep photographing within minutes, not hours.", correct: true, explanation: "Backup means continuity, not a later warehouse fix." },
      { id: "q-backup-kit-b", label: "Only comfort items, because the main cases should cover the work.", correct: false, explanation: "Backups are operational tools, not extras." },
      { id: "q-backup-kit-c", label: "Only the lead photographer's personal preferences.", correct: false, explanation: "The kit exists for the job, not individual habits." }
    ]
  },
  {
    id: "q-weights-first",
    module_id: "module-equipment-setup",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "What is the correct order when staging light stands in a school hallway?",
    scenario: "Students are already moving near the setup zone.",
    choices: [
      { id: "q-weights-first-a", label: "Position, weight, and clear the walking lane before fine adjustments.", correct: true, explanation: "Safety comes before polish." },
      { id: "q-weights-first-b", label: "Dial in the light precisely, then add weights once you are happy with placement.", correct: false, explanation: "That leaves a preventable safety gap." },
      { id: "q-weights-first-c", label: "Skip weights if the lead says the floor looks level.", correct: false, explanation: "Weighted stands are not optional." }
    ]
  },
  {
    id: "q-test-frame",
    module_id: "module-equipment-setup",
    roles: ["associate_photographer", "senior_photographer", "leadership"],
    prompt: "What makes a test frame operationally complete?",
    scenario: "You need something leadership could trust if asked to review it quickly.",
    choices: [
      { id: "q-test-frame-a", label: "Lighting, framing, background, and student-positioning lane all checked together.", correct: true, explanation: "A test frame should confirm the station, not just the camera." },
      { id: "q-test-frame-b", label: "Only exposure, because posing can be fixed later.", correct: false, explanation: "Flow issues often appear in the first real student if the lane is not tested." },
      { id: "q-test-frame-c", label: "Whatever looks acceptable on the camera back.", correct: false, explanation: "Acceptable is not the same as reviewed." }
    ]
  },
  {
    id: "q-cable-lane",
    module_id: "module-equipment-setup",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "How should cables and tether lines be treated on picture day?",
    scenario: "Families and students will move faster than the setup team expects.",
    choices: [
      { id: "q-cable-lane-a", label: "Protected and routed out of the walking lane every time.", correct: true, explanation: "The operational standard is no avoidable trip hazard." },
      { id: "q-cable-lane-b", label: "Acceptable if someone from the team watches them closely.", correct: false, explanation: "Watching a hazard is not removing it." },
      { id: "q-cable-lane-c", label: "Fine if the cable is flat and only adults are nearby.", correct: false, explanation: "The rule does not depend on who is walking past." }
    ]
  },
  {
    id: "q-line-pause",
    module_id: "module-school-day-flow",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "When the wrong class enters the line, what is the best first move?",
    scenario: "You can either rush through it or reset cleanly.",
    choices: [
      { id: "q-line-pause-a", label: "Pause the lane, confirm the roster, and restart with one clear instruction.", correct: true, explanation: "A clean reset prevents a larger data and pacing problem." },
      { id: "q-line-pause-b", label: "Photograph the class and trust production to correct it later.", correct: false, explanation: "That pushes preventable damage downstream." },
      { id: "q-line-pause-c", label: "Send the class away without explanation so the next class can keep moving.", correct: false, explanation: "That creates confusion and school frustration." }
    ]
  },
  {
    id: "q-teacher-queue",
    module_id: "module-school-day-flow",
    roles: ["senior_photographer", "leadership"],
    prompt: "A teacher wants to skip the current class order. What should guide the answer?",
    scenario: "You need to honor the school relationship without breaking the whole flow.",
    choices: [
      { id: "q-teacher-queue-a", label: "Clarify the reason, weigh the operational impact, and explain the cleanest workable option.", correct: true, explanation: "Leadership wants decisions that feel respectful and operationally sound." },
      { id: "q-teacher-queue-b", label: "Say yes immediately because teachers outrank the photo plan.", correct: false, explanation: "Automatic yes can break the broader day." },
      { id: "q-teacher-queue-c", label: "Say no immediately because the queue is fixed once it starts.", correct: false, explanation: "Good field leadership is flexible, not rigid." }
    ]
  },
  {
    id: "q-late-classroom",
    module_id: "module-school-day-flow",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "What should happen when a classroom arrives late and the line is already full?",
    scenario: "The goal is to protect both fairness and pacing.",
    choices: [
      { id: "q-late-classroom-a", label: "Slot them into the next clear opening and communicate the plan visibly.", correct: true, explanation: "Visible sequencing keeps the school from feeling ignored." },
      { id: "q-late-classroom-b", label: "Push them to the front because they are already behind.", correct: false, explanation: "That can create a new problem for every class already waiting." },
      { id: "q-late-classroom-c", label: "Tell them to return later with no other context.", correct: false, explanation: "That feels dismissive and creates more hallway churn." }
    ]
  },
  {
    id: "q-nervous-kindergartner",
    module_id: "module-student-interaction",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "A kindergartner freezes on the posing mark. What is the best move?",
    scenario: "You need the line to move, but the student still needs a good moment.",
    choices: [
      { id: "q-nervous-kindergartner-a", label: "Slow your tone, give one tiny direction, and praise the first success.", correct: true, explanation: "Small wins help a nervous student recover quickly." },
      { id: "q-nervous-kindergartner-b", label: "Tell them the line is waiting and they need to smile now.", correct: false, explanation: "Pressure usually makes the expression worse." },
      { id: "q-nervous-kindergartner-c", label: "Skip the child immediately and leave the teacher to fix it.", correct: false, explanation: "That is not the first-line Kemmetmueller response." }
    ]
  },
  {
    id: "q-athlete-energy",
    module_id: "module-student-interaction",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "A high-school athlete is joking with the whole line. What should the photographer do?",
    scenario: "You want energy, but you still own the pace.",
    choices: [
      { id: "q-athlete-energy-a", label: "Match the energy briefly, then redirect it into one clear posing cue.", correct: true, explanation: "Good control feels confident, not stern." },
      { id: "q-athlete-energy-b", label: "Shut the joke down hard so everyone gets serious immediately.", correct: false, explanation: "That can sour the whole lane." },
      { id: "q-athlete-energy-c", label: "Let the student keep the line entertained until the coach steps in.", correct: false, explanation: "The photographer still owns the station." }
    ]
  },
  {
    id: "q-parent-observer",
    module_id: "module-student-interaction",
    roles: ["senior_photographer", "leadership"],
    prompt: "A parent is hovering near the posing area. What is the best response?",
    scenario: "You want the student comfortable and the lane protected.",
    choices: [
      { id: "q-parent-observer-a", label: "Welcome them, then guide them to the best viewing spot outside the lane.", correct: true, explanation: "This keeps the parent included without crowding the set." },
      { id: "q-parent-observer-b", label: "Ignore them unless they become a problem.", correct: false, explanation: "Silence can feel colder than the moment needs." },
      { id: "q-parent-observer-c", label: "Tell them parents are not allowed near the line under any circumstances.", correct: false, explanation: "That is more rigid than the standard requires." }
    ]
  },
  {
    id: "q-chin-angle",
    module_id: "module-pose-expression",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "What is often the fastest posing correction on a flat student portrait?",
    scenario: "You need one move that improves the frame fast.",
    choices: [
      { id: "q-chin-angle-a", label: "Adjust chin and eye line before giving a bigger body reset.", correct: true, explanation: "Small head-position changes often create the quickest lift." },
      { id: "q-chin-angle-b", label: "Change the background first.", correct: false, explanation: "That is not the fastest correction in the lane." },
      { id: "q-chin-angle-c", label: "Ask the student to improvise a pose.", correct: false, explanation: "The station should stay controlled." }
    ]
  },
  {
    id: "q-shoulder-fix",
    module_id: "module-pose-expression",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "Shoulder angle feels stiff. What is the strongest next cue?",
    scenario: "You want to loosen the frame without over-directing.",
    choices: [
      { id: "q-shoulder-fix-a", label: "Give one clean shoulder turn and reset the hands only if needed.", correct: true, explanation: "One precise cue usually beats a stack of corrections." },
      { id: "q-shoulder-fix-b", label: "Start over with a brand new pose immediately.", correct: false, explanation: "That can waste time if the frame only needs a small correction." },
      { id: "q-shoulder-fix-c", label: "Leave it alone if the expression is good.", correct: false, explanation: "Small structural fixes still matter." }
    ]
  },
  {
    id: "q-histogram",
    module_id: "module-lighting-camera",
    roles: ["associate_photographer", "senior_photographer", "leadership"],
    prompt: "Why does the first test frame need a real technical review, not just a quick glance?",
    scenario: "You are protecting the whole day, not just one student.",
    choices: [
      { id: "q-histogram-a", label: "Because exposure drift compounds once the line is moving.", correct: true, explanation: "A weak baseline creates expensive consistency problems." },
      { id: "q-histogram-b", label: "Because leadership prefers a longer setup time.", correct: false, explanation: "Leadership wants speed and certainty, not delay." },
      { id: "q-histogram-c", label: "Because the camera screen is the most accurate final image preview.", correct: false, explanation: "It helps, but that is not the operational reason." }
    ]
  },
  {
    id: "q-white-balance",
    module_id: "module-lighting-camera",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "Why lock white balance for the station instead of trusting auto?",
    scenario: "The gym lighting is mixed and the volume is high.",
    choices: [
      { id: "q-white-balance-a", label: "Consistency across the day matters more than a few lucky auto reads.", correct: true, explanation: "Locked technical standards protect production quality." },
      { id: "q-white-balance-b", label: "Auto white balance is only for sports, not schools.", correct: false, explanation: "That is not the real rule." },
      { id: "q-white-balance-c", label: "It makes the camera battery last longer.", correct: false, explanation: "Not the point of the standard." }
    ]
  },
  {
    id: "q-battery-rotation",
    module_id: "module-lighting-camera",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "What is the best battery discipline on a long school day?",
    scenario: "The goal is zero surprise shutdowns in the middle of a class change.",
    choices: [
      { id: "q-battery-rotation-a", label: "Rotate before risk, not after the warning becomes urgent.", correct: true, explanation: "Operational habits should prevent the scramble." },
      { id: "q-battery-rotation-b", label: "Run batteries until they force a change so you waste less charge.", correct: false, explanation: "That creates the exact interruption the standard is trying to avoid." },
      { id: "q-battery-rotation-c", label: "Only the senior lead needs to monitor battery timing.", correct: false, explanation: "Every operator should notice battery risk." }
    ]
  },
  {
    id: "q-duplicate-name",
    module_id: "module-data-roster",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "Two students have the same last name and similar first names. What should happen?",
    scenario: "The line is moving fast and it would be easy to guess wrong.",
    choices: [
      { id: "q-duplicate-name-a", label: "Pause long enough to confirm the roster entry before shooting.", correct: true, explanation: "A short pause is cheaper than a mislabeled student." },
      { id: "q-duplicate-name-b", label: "Shoot both and let production sort it out later.", correct: false, explanation: "That shifts a preventable field mistake downstream." },
      { id: "q-duplicate-name-c", label: "Ask the student which package they ordered and use that as the identifier.", correct: false, explanation: "That is not a reliable roster-control step." }
    ]
  },
  {
    id: "q-missing-roster",
    module_id: "module-data-roster",
    roles: ["senior_photographer", "leadership"],
    prompt: "A classroom arrives but its roster is missing. What is the right operational choice?",
    scenario: "The team wants to stay helpful without creating bad data.",
    choices: [
      { id: "q-missing-roster-a", label: "Escalate immediately and hold the class cleanly until data is confirmed.", correct: true, explanation: "The cost of bad data is higher than a controlled pause." },
      { id: "q-missing-roster-b", label: "Photograph the class and mark them as unknown students.", correct: false, explanation: "Unknown records create avoidable downstream work." },
      { id: "q-missing-roster-c", label: "Send the class away without explanation.", correct: false, explanation: "The school still needs a calm operational handoff." }
    ]
  },
  {
    id: "q-package-mismatch",
    module_id: "module-data-roster",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "A teacher says a package choice looks wrong. What should happen next?",
    scenario: "You need a confident but safe response.",
    choices: [
      { id: "q-package-mismatch-a", label: "Flag it, confirm the record, and document the correction path before moving on.", correct: true, explanation: "Small documentation steps protect the final order." },
      { id: "q-package-mismatch-b", label: "Change it based on memory so the line does not slow down.", correct: false, explanation: "Memory is not a data-control workflow." },
      { id: "q-package-mismatch-c", label: "Ignore it because package issues are not the photographer's problem.", correct: false, explanation: "Field teams still own a clean handoff." }
    ]
  },
  {
    id: "q-escalate-early",
    module_id: "module-troubleshooting",
    roles: ["associate_photographer", "senior_photographer", "leadership"],
    prompt: "What does strong troubleshooting judgement look like?",
    scenario: "A problem is still small enough to recover cleanly.",
    choices: [
      { id: "q-escalate-early-a", label: "Escalate while the team still has options, not after the lane is fully stalled.", correct: true, explanation: "Early escalation protects the day." },
      { id: "q-escalate-early-b", label: "Hide the problem until you are sure no one can solve it alone.", correct: false, explanation: "That usually makes the recovery worse." },
      { id: "q-escalate-early-c", label: "Stop the whole day any time something feels imperfect.", correct: false, explanation: "Good judgment is calm, not dramatic." }
    ]
  },
  {
    id: "q-spare-body",
    module_id: "module-troubleshooting",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "A camera body fails during a class transition. What is the best move?",
    scenario: "You have a spare body and a short window before the next class arrives.",
    choices: [
      { id: "q-spare-body-a", label: "Swap to the spare, notify the lead, and keep the line informed.", correct: true, explanation: "That keeps recovery visible and controlled." },
      { id: "q-spare-body-b", label: "Try to fix the dead body first while the next class waits silently.", correct: false, explanation: "That burns the clean recovery window." },
      { id: "q-spare-body-c", label: "Dismiss the next class until later in the afternoon.", correct: false, explanation: "That is a bigger disruption than needed." }
    ]
  },
  {
    id: "q-gym-relocation",
    module_id: "module-troubleshooting",
    roles: ["senior_photographer", "leadership"],
    prompt: "A gym setup has to move because of an unexpected assembly. What matters most?",
    scenario: "The school needs confidence that the team still has a plan.",
    choices: [
      { id: "q-gym-relocation-a", label: "Announce the new plan clearly, protect data and gear, and reset the line with one leader voice.", correct: true, explanation: "Operational clarity is the first recovery tool." },
      { id: "q-gym-relocation-b", label: "Move pieces quietly so the school does not get nervous.", correct: false, explanation: "Silence can make the situation feel more chaotic." },
      { id: "q-gym-relocation-c", label: "Wait for leadership to arrive in person before doing anything.", correct: false, explanation: "Field leads should still start the recovery." }
    ]
  },
  {
    id: "q-card-check",
    module_id: "module-post-shoot-wrap",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "What is the most important close-out habit before leaving the school?",
    scenario: "The day feels finished, but the work is not truly done yet.",
    choices: [
      { id: "q-card-check-a", label: "Verify data and gear closeout before the vehicle door shuts.", correct: true, explanation: "Late discoveries are the hardest to fix." },
      { id: "q-card-check-b", label: "Leave fast and trust the studio to catch anything missing later.", correct: false, explanation: "That is the opposite of wrap discipline." },
      { id: "q-card-check-c", label: "Only the lead needs to think about closeout details.", correct: false, explanation: "Wrap quality is a team responsibility." }
    ]
  },
  {
    id: "q-left-behind",
    module_id: "module-post-shoot-wrap",
    roles: ["associate_photographer", "senior_photographer"],
    prompt: "Why is a physical pack list still important after a smooth day?",
    scenario: "Everyone feels tired and wants to get back on the road.",
    choices: [
      { id: "q-left-behind-a", label: "Because fatigue is exactly when small gear losses happen.", correct: true, explanation: "Wrap systems exist for the tired version of the team." },
      { id: "q-left-behind-b", label: "Because leadership does not trust the team.", correct: false, explanation: "It is about reliability, not suspicion." },
      { id: "q-left-behind-c", label: "Because the list matters more than the data handoff.", correct: false, explanation: "Both matter; it is not either-or." }
    ]
  },
  {
    id: "q-client-followup",
    module_id: "module-post-shoot-wrap",
    roles: ["senior_photographer", "leadership"],
    prompt: "What should leadership expect before a lead fully closes the day?",
    scenario: "The school contact still needs confidence that the day landed well.",
    choices: [
      { id: "q-client-followup-a", label: "A brief, clear closeout note or verbal handoff with any outstanding follow-up called out.", correct: true, explanation: "The closeout is part of the service experience." },
      { id: "q-client-followup-b", label: "No follow-up unless the school specifically asks for one.", correct: false, explanation: "The best teams close the loop proactively." },
      { id: "q-client-followup-c", label: "A detailed technical report every time.", correct: false, explanation: "Too heavy for the normal closeout expectation." }
    ]
  }
];
const questionIndex = new Map(questionBank.map((question) => [question.id, question]));

export function buildModuleProgress(
  overrides: Partial<EmployeeTrainingModuleProgress> & Pick<EmployeeTrainingModuleProgress, "module_id" | "status">
): EmployeeTrainingModuleProgress {
  return {
    progress_percent: 0,
    signoff_status: moduleIndex.get(overrides.module_id)?.signoff_required ? "pending" : "not_required",
    acknowledgement_complete: false,
    ...overrides
  };
}

export function cloneProfile(profile: EmployeeTrainingProfile): EmployeeTrainingProfile {
  return {
    ...profile,
    employee: { ...profile.employee, roles: [...profile.employee.roles] },
    modules: profile.modules.map((module) => ({ ...module })),
    quiz_history: profile.quiz_history.map((attempt) => ({ ...attempt, missed_question_ids: [...attempt.missed_question_ids] })),
    checkpoints: profile.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    acknowledgements: profile.acknowledgements.map((ack) => ({ ...ack }))
  };
}

export function getQuizQuestions(questionIds: string[]) {
  return questionIds
    .map((questionId) => questionIndex.get(questionId))
    .filter((question): question is TrainingQuizQuestion => Boolean(question))
    .map((question) => ({
      ...question,
      roles: [...question.roles],
      choices: question.choices.map((choice) => ({ ...choice }))
    }));
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function calculateProgress(modules: EmployeeTrainingModuleProgress[], requiredOnly: boolean) {
  const filtered = modules.filter((module) => {
    const source = moduleIndex.get(module.module_id);
    return requiredOnly ? Boolean(source?.required) : !source?.required;
  });
  if (!filtered.length) {
    return 0;
  }
  return Math.round(filtered.reduce((sum, module) => sum + module.progress_percent, 0) / filtered.length);
}

export function deriveReadiness(profile: EmployeeTrainingProfile) {
  const requiredModules = profile.modules.filter((module) => moduleIndex.get(module.module_id)?.required);
  if (requiredModules.some((module) => module.status === "overdue")) {
    return {
      state: "retraining_required" as const,
      note: "Overdue required workbook modules are blocking the next school-shoot assignment."
    };
  }
  if (requiredModules.some((module) => module.status !== "completed")) {
    return {
      state: "not_cleared" as const,
      note: "Required workbook work is still open before this employee can run a school shoot alone."
    };
  }
  if (requiredModules.some((module) => module.signoff_status === "pending")) {
    return {
      state: "cleared_with_oversight" as const,
      note: "Required learning is complete, but manager sign-off or live observation is still pending."
    };
  }
  return {
    state: "cleared" as const,
    note: "All required modules are complete and the employee is cleared for school shoots."
  };
}

export function normalizeProfile(profile: EmployeeTrainingProfile) {
  const next = cloneProfile(profile);
  next.required_progress_percent = calculateProgress(next.modules, true);
  next.optional_progress_percent = calculateProgress(next.modules, false);
  next.workbook_progress_percent = Math.round(next.required_progress_percent * 0.8 + next.optional_progress_percent * 0.2);
  const readiness = deriveReadiness(next);
  next.readiness_state = readiness.state;
  next.readiness_note = readiness.note;
  return next;
}

export function getRecommendedModuleTitle(profile: EmployeeTrainingProfile) {
  return moduleIndex.get(pickChallengeModule(profile)?.module_id ?? "")?.title ?? "Company Standards";
}

export function pickChallengeModule(profile: EmployeeTrainingProfile) {
  return (
    profile.modules.find((module) => module.status === "overdue") ??
    profile.modules.find((module) => module.status === "needs_review") ??
    profile.modules.find((module) => module.status === "in_progress") ??
    profile.modules.find((module) => module.status === "not_started" && moduleIndex.get(module.module_id)?.required) ??
    profile.modules[0]
  );
}

export function getTrainingEmployeeSummaries(profiles: EmployeeTrainingProfile[]): TrainingEmployeeSummary[] {
  return profiles.map((profile) => ({
    identity: profile.employee,
    readiness_state: profile.readiness_state,
    readiness_note: profile.readiness_note,
    onboarding_stage: profile.onboarding_stage,
    workbook_progress_percent: profile.workbook_progress_percent,
    required_progress_percent: profile.required_progress_percent,
    optional_progress_percent: profile.optional_progress_percent,
    overdue_module_count: profile.modules.filter((module) => module.status === "overdue").length,
    needs_signoff:
      profile.manager_signoff_status === "pending" ||
      profile.modules.some((module) => module.signoff_status === "pending" && module.status === "completed"),
    next_module_title: getRecommendedModuleTitle(profile)
  }));
}

export function getTrainingDashboardSnapshot(profiles: EmployeeTrainingProfile[]): TrainingDashboardSnapshot {
  const overdueModules = profiles.flatMap((profile) =>
    profile.modules
      .filter((module) => module.status === "overdue")
      .map((module) => ({
        employee_name: profile.employee.full_name,
        module_title: moduleIndex.get(module.module_id)?.title ?? "Training module",
        due_at: module.due_at ?? profile.last_completed_at ?? new Date().toISOString(),
        readiness_state: profile.readiness_state
      }))
  );
  const departments = [...new Set(profiles.map((profile) => profile.employee.department))];

  return {
    org_completion_percent: average(profiles.map((profile) => profile.workbook_progress_percent)),
    required_completion_percent: average(profiles.map((profile) => profile.required_progress_percent)),
    optional_completion_percent: average(profiles.map((profile) => profile.optional_progress_percent)),
    overdue_module_count: overdueModules.length,
    not_cleared_count: profiles.filter((profile) => profile.readiness_state === "not_cleared").length,
    oversight_count: profiles.filter((profile) => profile.readiness_state === "cleared_with_oversight").length,
    retraining_required_count: profiles.filter((profile) => profile.readiness_state === "retraining_required").length,
    new_hires_in_onboarding: profiles.filter((profile) => /week|onboarding|shadow|pending|invite/i.test(profile.onboarding_stage)).length,
    recent_completions: profiles
      .flatMap((profile) =>
        profile.modules
          .filter((module) => module.completed_at)
          .map((module) => ({
            employee_name: profile.employee.full_name,
            module_title: moduleIndex.get(module.module_id)?.title ?? "Training module",
            completed_at: module.completed_at as string
          }))
      )
      .sort((left, right) => new Date(right.completed_at).getTime() - new Date(left.completed_at).getTime())
      .slice(0, 5),
    recent_quiz_scores: profiles
      .flatMap((profile) =>
        profile.quiz_history.map((attempt) => ({
          employee_name: profile.employee.full_name,
          score_percent: attempt.score_percent,
          played_at: attempt.played_at
        }))
      )
      .sort((left, right) => new Date(right.played_at).getTime() - new Date(left.played_at).getTime())
      .slice(0, 6),
    recent_signoffs: profiles
      .flatMap((profile) =>
        profile.modules
          .filter((module) => module.signoff_status === "complete" && module.completed_at)
          .map((module) => ({
            employee_name: profile.employee.full_name,
            module_title: moduleIndex.get(module.module_id)?.title ?? "Training module",
            signed_off_by: profile.employee.roles.includes("leadership") ? "Owner leadership review" : "Field manager review",
            signed_off_at: module.completed_at as string
          }))
      )
      .sort((left, right) => new Date(right.signed_off_at).getTime() - new Date(left.signed_off_at).getTime())
      .slice(0, 5),
    most_overdue_modules: overdueModules.sort((left, right) => new Date(left.due_at).getTime() - new Date(right.due_at).getTime()).slice(0, 5),
    completion_by_team: departments.map((department) => {
      const teamProfiles = profiles.filter((profile) => profile.employee.department === department);
      return {
        team: department,
        completion_percent: average(teamProfiles.map((profile) => profile.workbook_progress_percent)),
        cleared_count: teamProfiles.filter((profile) => profile.readiness_state === "cleared").length,
        total_count: teamProfiles.length
      };
    })
  };
}

export const templateProfiles: Record<string, EmployeeTrainingProfile> = {
  leadership: {
    employee: {
      id: "template-leadership",
      email: "matthew@example.com",
      full_name: "Matthew Kemmetmueller",
      department: "operations",
      roles: ["owner_admin", "leadership"],
      employment_status: "active"
    },
    assigned_learning_path: "Leadership and field readiness",
    onboarding_stage: "Field-certified",
    readiness_state: "cleared",
    readiness_note: "Can be staffed on school shoots without extra coverage.",
    workbook_progress_percent: 94,
    required_progress_percent: 100,
    optional_progress_percent: 78,
    manager_signoff_status: "complete",
    modules: trainingModules.map((module) =>
      buildModuleProgress({
        module_id: module.id,
        status: "completed",
        progress_percent: module.required ? 100 : 80,
        completed_at: "2026-03-18T16:30:00.000Z",
        best_score: 96,
        signoff_status: module.signoff_required ? "complete" : "not_required",
        acknowledgement_complete: true,
        version_completed: module.version
      })
    ),
    quiz_history: [
      {
        id: "attempt-template-leadership-1",
        round_title: "Picture Day Challenge | Technical standards",
        module_id: "module-lighting-camera",
        played_at: "2026-03-22T15:20:00.000Z",
        score_percent: 100,
        passed: true,
        correct_count: 5,
        question_count: 5,
        missed_question_ids: []
      }
    ],
    checkpoints: [
      {
        checkpoint_id: "checkpoint-setup-safety",
        status: "pass",
        notes: "Leadership review complete.",
        reviewed_at: "2026-03-18T16:45:00.000Z"
      }
    ],
    acknowledgements: trainingAcknowledgements.map((ack) => ({
      acknowledgement_id: ack.id,
      acknowledged: true,
      acknowledged_at: "2026-03-18T16:00:00.000Z"
    })),
    last_completed_at: "2026-03-22T15:20:00.000Z"
  },
  senior: {
    employee: {
      id: "template-senior",
      email: "senior@example.com",
      full_name: "Demo Senior Photographer",
      department: "schools",
      roles: ["senior_photographer"],
      employment_status: "active"
    },
    assigned_learning_path: "Senior photographer readiness",
    onboarding_stage: "Oversight rotation",
    readiness_state: "cleared_with_oversight",
    readiness_note: "Can run a school shoot, but leadership still wants a quick technical review on large-volume days.",
    workbook_progress_percent: 82,
    required_progress_percent: 88,
    optional_progress_percent: 64,
    manager_signoff_status: "pending",
    modules: trainingModules.map((module) =>
      buildModuleProgress({
        module_id: module.id,
        status: module.id === "module-lighting-camera" ? "needs_review" : module.id === "module-post-shoot-wrap" ? "in_progress" : "completed",
        progress_percent: module.id === "module-lighting-camera" ? 68 : module.id === "module-post-shoot-wrap" ? 45 : module.required ? 100 : 82,
        due_at: module.id === "module-lighting-camera" ? "2026-03-27T17:00:00.000Z" : null,
        completed_at: module.id === "module-lighting-camera" || module.id === "module-post-shoot-wrap" ? null : "2026-03-10T14:00:00.000Z",
        best_score: module.id === "module-lighting-camera" ? 76 : 92,
        signoff_status: module.signoff_required ? (module.id === "module-lighting-camera" ? "pending" : "complete") : "not_required",
        acknowledgement_complete: module.id !== "module-lighting-camera",
        version_completed: module.id === "module-lighting-camera" ? null : module.version
      })
    ),
    quiz_history: [
      {
        id: "attempt-template-senior-1",
        round_title: "Picture Day Challenge | Lighting and Camera Standards",
        module_id: "module-lighting-camera",
        played_at: "2026-03-23T18:10:00.000Z",
        score_percent: 76,
        passed: false,
        correct_count: 4,
        question_count: 5,
        missed_question_ids: ["q-white-balance"]
      }
    ],
    checkpoints: [
      {
        checkpoint_id: "checkpoint-exposure-standard",
        status: "attention",
        notes: "Needs one more live review on exposure consistency.",
        reviewed_at: "2026-03-23T18:20:00.000Z"
      }
    ],
    acknowledgements: trainingAcknowledgements.map((ack) => ({
      acknowledgement_id: ack.id,
      acknowledged: ack.module_id !== "module-lighting-camera",
      acknowledged_at: ack.module_id !== "module-lighting-camera" ? "2026-03-10T14:00:00.000Z" : null
    })),
    last_completed_at: "2026-03-18T17:45:00.000Z",
    oversight_note: "Schedule with oversight on high-volume gym days until technical refresh is signed off."
  },
  photographer: {
    employee: {
      id: "template-photographer",
      email: "photo@example.com",
      full_name: "Demo Photographer",
      department: "schools",
      roles: ["associate_photographer"],
      employment_status: "active"
    },
    assigned_learning_path: "School photographer onboarding",
    onboarding_stage: "Field shadow week 2",
    readiness_state: "not_cleared",
    readiness_note: "Not cleared for solo school shoots yet. Needs school-day-flow and data accuracy completion.",
    workbook_progress_percent: 54,
    required_progress_percent: 49,
    optional_progress_percent: 38,
    manager_signoff_status: "pending",
    modules: trainingModules.map((module) =>
      buildModuleProgress({
        module_id: module.id,
        status:
          module.id === "module-company-standards" || module.id === "module-pre-shoot-prep" || module.id === "module-student-interaction"
            ? "completed"
            : module.id === "module-equipment-setup" || module.id === "module-school-day-flow" || module.id === "module-data-roster"
              ? "in_progress"
              : "not_started",
        progress_percent:
          module.id === "module-company-standards"
            ? 100
            : module.id === "module-pre-shoot-prep"
              ? 100
              : module.id === "module-student-interaction"
                ? 92
                : module.id === "module-equipment-setup"
                  ? 62
                  : module.id === "module-school-day-flow"
                    ? 58
                    : module.id === "module-data-roster"
                      ? 44
                      : 0,
        due_at: ["module-equipment-setup", "module-school-day-flow", "module-data-roster"].includes(module.id) ? "2026-03-28T18:00:00.000Z" : null,
        completed_at: ["module-company-standards", "module-pre-shoot-prep", "module-student-interaction"].includes(module.id) ? "2026-03-20T15:00:00.000Z" : null,
        best_score: module.id === "module-equipment-setup" ? 84 : module.id === "module-school-day-flow" ? 72 : module.id === "module-data-roster" ? 68 : 90,
        signoff_status: module.signoff_required ? "pending" : "not_required",
        acknowledgement_complete: ["module-company-standards", "module-pre-shoot-prep", "module-student-interaction"].includes(module.id),
        version_completed: ["module-company-standards", "module-pre-shoot-prep"].includes(module.id) ? module.version : null
      })
    ),
    quiz_history: [
      {
        id: "attempt-template-photographer-1",
        round_title: "Picture Day Challenge | Equipment Setup and Safety",
        module_id: "module-equipment-setup",
        played_at: "2026-03-23T13:10:00.000Z",
        score_percent: 84,
        passed: true,
        correct_count: 4,
        question_count: 5,
        missed_question_ids: ["q-cable-lane"]
      },
      {
        id: "attempt-template-photographer-2",
        round_title: "Picture Day Challenge | Running the School Day Flow",
        module_id: "module-school-day-flow",
        played_at: "2026-03-24T12:05:00.000Z",
        score_percent: 72,
        passed: false,
        correct_count: 3,
        question_count: 5,
        missed_question_ids: ["q-teacher-queue", "q-late-classroom"]
      }
    ],
    checkpoints: [
      { checkpoint_id: "checkpoint-setup-safety", status: "pass", notes: "Shadow setup looked clean.", reviewed_at: "2026-03-23T13:30:00.000Z" },
      { checkpoint_id: "checkpoint-lane-command", status: "pending", notes: "Needs one more observed school-day-flow run." }
    ],
    acknowledgements: trainingAcknowledgements.map((ack) => ({
      acknowledgement_id: ack.id,
      acknowledged: ["module-company-standards", "module-pre-shoot-prep", "module-student-interaction"].includes(ack.module_id),
      acknowledged_at: ["module-company-standards", "module-pre-shoot-prep", "module-student-interaction"].includes(ack.module_id) ? "2026-03-20T15:00:00.000Z" : null
    })),
    last_completed_at: "2026-03-20T15:00:00.000Z"
  },
  associate: {
    employee: {
      id: "template-associate",
      email: "associate@example.com",
      full_name: "Demo Associate Photographer",
      department: "schools",
      roles: ["associate_photographer"],
      employment_status: "active"
    },
    assigned_learning_path: "School photographer onboarding",
    onboarding_stage: "New hire ramp",
    readiness_state: "retraining_required",
    readiness_note: "Retraining required before the next school shoot. Overdue technical and data modules are blocking clearance.",
    workbook_progress_percent: 32,
    required_progress_percent: 28,
    optional_progress_percent: 20,
    manager_signoff_status: "pending",
    modules: trainingModules.map((module) =>
      buildModuleProgress({
        module_id: module.id,
        status: module.id === "module-company-standards" ? "completed" : ["module-equipment-setup", "module-lighting-camera", "module-data-roster"].includes(module.id) ? "overdue" : "not_started",
        progress_percent: module.id === "module-company-standards" ? 100 : module.id === "module-equipment-setup" ? 38 : module.id === "module-lighting-camera" ? 21 : module.id === "module-data-roster" ? 34 : 0,
        due_at: ["module-equipment-setup", "module-lighting-camera", "module-data-roster"].includes(module.id) ? "2026-03-21T17:00:00.000Z" : null,
        completed_at: module.id === "module-company-standards" ? "2026-03-12T14:00:00.000Z" : null,
        best_score: module.id === "module-equipment-setup" ? 62 : module.id === "module-lighting-camera" ? 58 : module.id === "module-data-roster" ? 60 : null,
        signoff_status: module.signoff_required ? "pending" : "not_required",
        acknowledgement_complete: module.id === "module-company-standards",
        version_completed: module.id === "module-company-standards" ? module.version : null
      })
    ),
    quiz_history: [
      {
        id: "attempt-template-associate-1",
        round_title: "Picture Day Challenge | Lighting and Camera Standards",
        module_id: "module-lighting-camera",
        played_at: "2026-03-22T17:50:00.000Z",
        score_percent: 58,
        passed: false,
        correct_count: 2,
        question_count: 5,
        missed_question_ids: ["q-histogram", "q-white-balance", "q-battery-rotation"]
      }
    ],
    checkpoints: [
      { checkpoint_id: "checkpoint-exposure-standard", status: "attention", notes: "Retraining needed before solo station work." }
    ],
    acknowledgements: trainingAcknowledgements.map((ack) => ({
      acknowledgement_id: ack.id,
      acknowledged: ack.module_id === "module-company-standards",
      acknowledged_at: ack.module_id === "module-company-standards" ? "2026-03-12T14:00:00.000Z" : null
    })),
    last_completed_at: "2026-03-12T14:00:00.000Z",
    oversight_note: "Do not assign without a senior photographer present until retraining is complete."
  },
  office: {
    employee: {
      id: "template-office",
      email: "office@example.com",
      full_name: "Demo Office Employee",
      department: "office",
      roles: ["office_employee"],
      employment_status: "active"
    },
    assigned_learning_path: "Studio and office support",
    onboarding_stage: "Office-ready",
    readiness_state: "cleared_with_oversight",
    readiness_note: "Cleared for office and studio support. School shoot coverage still requires oversight.",
    workbook_progress_percent: 61,
    required_progress_percent: 52,
    optional_progress_percent: 70,
    manager_signoff_status: "pending",
    modules: trainingModules.map((module) =>
      buildModuleProgress({
        module_id: module.id,
        status: ["module-company-standards", "module-data-roster", "module-post-shoot-wrap"].includes(module.id) ? "completed" : module.id === "module-school-day-flow" ? "in_progress" : module.required ? "not_started" : "completed",
        progress_percent: ["module-company-standards", "module-data-roster", "module-post-shoot-wrap"].includes(module.id) ? 100 : module.id === "module-school-day-flow" ? 55 : module.required ? 0 : 88,
        best_score: module.id === "module-school-day-flow" ? 79 : 90,
        signoff_status: module.signoff_required ? "pending" : "not_required",
        acknowledgement_complete: ["module-company-standards", "module-data-roster", "module-post-shoot-wrap"].includes(module.id),
        completed_at: ["module-company-standards", "module-data-roster", "module-post-shoot-wrap"].includes(module.id) ? "2026-03-15T12:00:00.000Z" : null,
        version_completed: ["module-company-standards", "module-data-roster", "module-post-shoot-wrap"].includes(module.id) ? module.version : null
      })
    ),
    quiz_history: [
      {
        id: "attempt-template-office-1",
        round_title: "Picture Day Challenge | Data and Roster Accuracy",
        module_id: "module-data-roster",
        played_at: "2026-03-21T11:15:00.000Z",
        score_percent: 92,
        passed: true,
        correct_count: 5,
        question_count: 5,
        missed_question_ids: []
      }
    ],
    checkpoints: [
      { checkpoint_id: "checkpoint-roster-audit", status: "pass", notes: "Strong roster review discipline.", reviewed_at: "2026-03-21T11:30:00.000Z" }
    ],
    acknowledgements: trainingAcknowledgements.map((ack) => ({
      acknowledgement_id: ack.id,
      acknowledged: ["module-company-standards", "module-data-roster", "module-post-shoot-wrap"].includes(ack.module_id),
      acknowledged_at: ["module-company-standards", "module-data-roster", "module-post-shoot-wrap"].includes(ack.module_id) ? "2026-03-15T12:00:00.000Z" : null
    })),
    last_completed_at: "2026-03-21T11:15:00.000Z",
    oversight_note: "Keep office staff paired with a field lead for any live school floor support."
  },
  newhire: {
    employee: {
      id: "template-newhire",
      email: "newhire@example.com",
      full_name: "Demo New Hire",
      department: "schools",
      roles: ["associate_photographer"],
      employment_status: "active"
    },
    assigned_learning_path: "School photographer onboarding",
    onboarding_stage: "Week 1 onboarding",
    readiness_state: "not_cleared",
    readiness_note: "New hire is not cleared for picture day assignment yet. Workbook has not started.",
    workbook_progress_percent: 6,
    required_progress_percent: 0,
    optional_progress_percent: 12,
    manager_signoff_status: "pending",
    modules: trainingModules.map((module) =>
      buildModuleProgress({
        module_id: module.id,
        status: module.required ? "not_started" : "in_progress",
        progress_percent: module.required ? 0 : 12,
        due_at: module.required ? "2026-03-31T17:00:00.000Z" : null,
        best_score: null,
        signoff_status: module.signoff_required ? "pending" : "not_required",
        acknowledgement_complete: false
      })
    ),
    quiz_history: [],
    checkpoints: trainingModules.slice(0, 4).map((module) => ({
      checkpoint_id: module.checkpoint_ids[0],
      status: "pending" as const,
      notes: "Checkpoint will unlock after workbook start."
    })),
    acknowledgements: trainingAcknowledgements.map((ack) => ({ acknowledgement_id: ack.id, acknowledged: false })),
    last_completed_at: null
  }
};

export function getBestScoreForModule(profile: EmployeeTrainingProfile, moduleId?: string | null) {
  if (!moduleId) {
    return profile.quiz_history[0]?.score_percent ?? 0;
  }
  return Math.max(0, ...profile.quiz_history.filter((attempt) => attempt.module_id === moduleId).map((attempt) => attempt.score_percent));
}

export function buildPictureDayChallenge(
  profile: EmployeeTrainingProfile,
  options?: { moduleId?: string | null; mode?: TrainingQuizRound["mode"]; questionIds?: string[] }
): TrainingQuizRound {
  const preferredModuleId = options?.moduleId ?? pickChallengeModule(profile)?.module_id ?? trainingModules[0]?.id;
  const eligibleQuestions = questionBank.filter((question) =>
    question.roles.some(
      (role) =>
        profile.employee.roles.includes(role) ||
        (role === "leadership" && profile.employee.roles.some((assignedRole) => ["leadership", "owner_admin", "admin"].includes(assignedRole)))
    )
  );
  const prioritized = [
    ...eligibleQuestions.filter((question) => question.module_id === preferredModuleId),
    ...eligibleQuestions.filter((question) => question.module_id !== preferredModuleId)
  ];
  const selectedQuestions = (
    options?.questionIds?.length
      ? options.questionIds.map((questionId) => questionIndex.get(questionId)).filter((question): question is TrainingQuizQuestion => Boolean(question))
      : prioritized.slice(0, 5)
  ).slice(0, 5);
  const moduleTitle = moduleIndex.get(preferredModuleId ?? "")?.title;
  return {
    id: `round-${profile.employee.id}-${preferredModuleId ?? "dashboard"}`,
    mode: options?.mode ?? "dashboard",
    title: `Picture Day Challenge | ${moduleTitle ?? "Operational Readiness"}`,
    module_id: preferredModuleId ?? null,
    question_ids: selectedQuestions.map((question) => question.id),
    pass_threshold: 80,
    best_score: getBestScoreForModule(profile, preferredModuleId),
    streak_placeholder: profile.quiz_history.filter((attempt) => attempt.passed).length
  };
}

export function scorePictureDayChallenge(round: TrainingQuizRound, answers: Record<string, string>) {
  const questions = getQuizQuestions(round.question_ids);
  const missedQuestionIds: string[] = [];
  let correctCount = 0;
  for (const question of questions) {
    const selectedChoice = answers[question.id];
    const correctChoice = question.choices.find((choice) => choice.correct);
    if (correctChoice && selectedChoice === correctChoice.id) {
      correctCount += 1;
    } else {
      missedQuestionIds.push(question.id);
    }
  }
  const scorePercent = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;
  const attempt: TrainingQuizAttempt = {
    id: "",
    round_title: round.title,
    module_id: round.module_id ?? null,
    played_at: new Date().toISOString(),
    score_percent: scorePercent,
    passed: scorePercent >= round.pass_threshold,
    correct_count: correctCount,
    question_count: questions.length,
    missed_question_ids: missedQuestionIds
  };
  return {
    attempt,
    questions
  };
}

export function applyQuizAttempt(profile: EmployeeTrainingProfile, attempt: TrainingQuizAttempt) {
  const next = cloneProfile(profile);
  next.quiz_history = [attempt, ...next.quiz_history].slice(0, 8);
  if (attempt.module_id) {
    next.modules = next.modules.map((module) => {
      if (module.module_id !== attempt.module_id) {
        return module;
      }
      const source = moduleIndex.get(module.module_id);
      return {
        ...module,
        status: attempt.passed ? "completed" : module.status === "overdue" ? "needs_review" : "in_progress",
        progress_percent: attempt.passed ? 100 : Math.max(module.progress_percent, Math.min(92, attempt.score_percent)),
        best_score: Math.max(module.best_score ?? 0, attempt.score_percent),
        completed_at: attempt.passed ? attempt.played_at : module.completed_at,
        acknowledgement_complete: attempt.passed ? true : module.acknowledgement_complete,
        version_completed: attempt.passed ? source?.version ?? module.version_completed ?? null : module.version_completed ?? null,
        signoff_status: source?.signoff_required ? "pending" : "not_required"
      };
    });
    const acknowledgementIds = moduleIndex.get(attempt.module_id)?.acknowledgement_ids ?? [];
    next.acknowledgements = next.acknowledgements.map((state) =>
      attempt.passed && acknowledgementIds.includes(state.acknowledgement_id)
        ? { ...state, acknowledged: true, acknowledged_at: attempt.played_at }
        : state
    );
    next.last_completed_at = attempt.passed ? attempt.played_at : next.last_completed_at;
  }
  return normalizeProfile(next);
}
