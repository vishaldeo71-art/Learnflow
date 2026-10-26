# Lumi learning companion

Live learning room: https://learnflow-theta.vercel.app/
Public authored playground: https://learnflow-theta.vercel.app/companion

Lumi is an original mint-coloured vector mascot, with articulated arm/hand gestures for listening, thinking, explaining, encouragement, and celebration. It floats beside the learning room and mock interview workspace. Reduced-motion preferences disable idle animation. No raster assets or additional npm packages were needed.

## Use it

1. Sign in and load a lesson with available course material. Click **Ask Lumi** at the lower-right corner.
2. Type a doubt, or tap the microphone, allow microphone access, dictate, review the transcript, and press Send. Dictation never submits on its own. Browser recognition may process audio online; Learnflow receives only submitted text.
3. Choose a companion language. Enable **Speak answers** or click **Read aloud** on an answer. Installed voices and recognition-language support depend on the browser/device. Typing and written answers remain available.
4. Click **Show 3D board** when a supported illustration is generated. Select a concept to inspect its explanation/source quotation. Drag the board or use the rotation slider. **Flat view** provides an accessible alternative. Scenes are bounded CSS 3D concept maps, comparisons, or sequences, not arbitrary scientific simulations or generated executable code.
5. Open **My progress** for real attempted questions, accuracy, saved notes, and due revision items. **Help with my mistakes** selects an actual weak quiz topic from watched material; where available it supplies the recorded submitted answer and feedback for a targeted course-grounded explanation.
6. Explicit English commands include **show my progress**, **show the visual**, **start a quiz**, **stop speaking**, and **close companion**. Review and send them like questions. Normal questions can use the selected language.

## Boundaries

The authenticated `POST /api/v1/companion/ask` route reuses the existing private learning guide. Source retrieval is restricted to the current playhead; unsupported answers do not receive invented visuals. A second structured Gemini call creates a presentation only from the answer's actual evidence. Scene type, number of nodes, source IDs, and exact quotations are validated. A failed visual leaves the sourced answer intact. Existing per-user ownership and service authentication remain in force.

The public `/companion` page is a clearly labelled authored sample. It does not expose private data, call paid AI without authentication, or invent progress. Its example is in English; the interface uses the selected locale. All 66 interface catalogs include the companion controls.

Closing the panel, changing the lesson/language, leaving the tab, or unmounting stops active voice output/recognition. Course changes cancel stale requests and clear the prior course's conversation. Password/email-confirmation configuration is unchanged by this feature.

## Verification

Backend tests cover grounding, quote validation, unsupported sources, scene allowlists, private-course isolation, no invented mistakes, watched-topic selection, and graceful visual failures. Frontend tests cover exact command parsing, real progress calculations, speech-safe text, and locale coverage. A live Gemini check uses an in-memory authored lesson; it does not modify production learner data. Browser checks cover the authored playground, interactive board, source expansion, language selection, and responsive layout. Real microphone capture and audible output still depend on the user's browser permissions, hardware, and installed voices.
