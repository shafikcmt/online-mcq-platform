# Online MCQ & Examination Platform — Phase-1 / MVP Scope

## Budget
Development budget: BDT 40,000.
External/third-party costs are not included in this development fee.

## Phase-1 Objective
Build a stable and usable first version of the Online MCQ & Examination Platform with the essential mobile, admin, website, backend, exam, result, OTP, subscription and payment workflows.

## Included Platforms
- Android Mobile Application — primary examination interface.
- Web-based Admin Panel — management of students, questions, exams, results, subscriptions and payments.
- Public Responsive Website — platform information, exam/package information, notices and app promotion.
- Secure Backend/API — centralized business logic and data access.
- Central PostgreSQL Database.

## Mobile App
### Account & Profile
- Registration using mobile number and/or email.
- SMS OTP verification during account registration.
- Login/logout.
- Forgot password / password reset.
- Basic profile management.
- Basic account settings.

### Dashboard
- Available exams.
- Upcoming exams.
- Practice exams.
- Free and paid exam labels/status.
- Active subscription/package status.
- Recent results.
- Exam history.
- Basic merit/leaderboard.
- Basic notifications/announcements.

### Exam Participation
- Open available exams from the app.
- MCQ question interface with multiple options.
- Previous/Next navigation.
- Question palette / question-number navigation.
- Answered/unanswered status.
- Mark for review.
- Countdown timer.
- Automatic submission when time expires.
- Manual final submission with confirmation.
- Negative marking where configured.
- Configurable marks per question.
- Basic random question and/or option order where required.
- Exam progress indicator.
- Server-side validation before accepting final submission.

## MCQ Exam Engine
- MCQ-based examinations.
- Configurable title, category, subject, duration, total questions, marks, negative marks and passing marks.
- Practice and regular exams.
- Basic scheduled/live exam support.
- Free/Paid exam flag.
- Server-controlled exam timing.
- Duplicate final-submission prevention.
- Server-side result calculation.

## Result & Basic Merit
- Total questions.
- Correct answers.
- Wrong answers.
- Unanswered questions.
- Negative marks.
- Obtained marks.
- Percentage.
- Pass/Fail status where applicable.
- Time used.
- Basic exam-wise merit position.
- Basic leaderboard.
- Exam history and previous result view.
- Admin-controlled result visibility.

## Admin Panel
### Dashboard
- Basic system overview.
- Student count.
- Exam count.
- Recent exams / activities.

### User Management
- View/search users.
- View basic profile.
- Activate/deactivate account where required.

### Category & Subject Management
- Create/edit/delete categories.
- Create/edit/delete subjects.

### Question Management
- Add/edit/delete MCQ questions.
- Assign category and subject.
- Add multiple options.
- Set correct answer.
- Add explanation if needed.
- Basic difficulty level where used.

### Exam Management
- Create/edit/delete exams.
- Assign questions to exams.
- Set duration, marks, negative marks and passing marks.
- Set exam visibility/status.
- Set schedule/date/time.
- Publish/unpublish exams.

### Result Management
- View submitted attempts.
- View results.
- Publish/hide results.
- Basic merit/leaderboard generation.

### Subscription & Package Management
- Create/edit packages.
- Package name, description, price, validity and status.
- Assign included exam access/rules.
- View active subscriptions.
- Subscription start/expiry.
- Automatic activation after verified successful payment.

### Payment Management
- Payment initiation architecture.
- Transaction ID/status.
- Pending / successful / failed / cancelled statuses.
- Server-side payment verification.
- Payment history.
- Integration target: bKash and/or Nagad API or SSLCommerz, depending on approved provider account and credentials.

### Basic Settings
- Platform name/logo.
- Basic announcement/notice content.
- App download link.

## Public Website
- Responsive home page.
- Platform introduction / key features.
- Available exams information.
- Upcoming exam information.
- Package/pricing information.
- Notice/announcement section.
- Basic results/leaderboard display where appropriate.
- About Us.
- Contact.
- FAQ.
- Download App / Google Play Store link.
- Login/Register link if required.
- Mobile/tablet/desktop responsive design.
- Website does NOT conduct the actual examination; examination interface is in the Mobile App.

## Backend / API / Database
- One centralized backend/API for Mobile App, Website and Admin Panel.
- Authentication and authorization.
- Basic role-based access.
- Input validation.
- Secure exam submission.
- Server-side result calculation.
- Basic rate limiting/API protection where applicable.
- Structured error handling.
- Core entities for users, OTPs, categories, subjects, questions, options, exams, attempts, answers, results, packages, subscriptions and payments.
- Database designed for future expansion.

## Basic Security
- Secure password hashing.
- Authentication/session or token management.
- Admin/user authorization.
- Input validation.
- SQL injection protection through framework/database best practices.
- XSS/CSRF protection where applicable.
- Server-side exam timing/result validation.
- Sensitive credentials stored in environment variables.
- Correct answers must not be unnecessarily exposed to the Mobile App before submission.
- Basic logging for important application errors/activities.

## Basic Testing & Delivery
- Registration/login/OTP testing.
- Exam loading/navigation testing.
- Timer/automatic submission testing.
- Negative-marking and result-calculation testing.
- Admin question/exam management testing.
- Basic subscription/payment flow testing with approved provider or sandbox/mock environment.
- Responsive website testing.
- Basic API/permission testing.
- Production deployment support for one agreed server/hosting environment.
- Source-code handover after completion/final payment.
- Basic setup/deployment notes.

## External Costs — Client Responsibility
The BDT 40,000 amount is development cost only. The client will separately bear all required third-party and infrastructure costs, including where applicable:
- Domain registration/renewal.
- Hosting/VPS/cloud server charges.
- SSL certificate charges if a paid certificate is used.
- SMS OTP/API provider fees and SMS balance.
- bKash/Nagad/SSLCommerz merchant onboarding, gateway, transaction or service charges.
- Google Play Console registration fee.
- Email/SMS/push-notification service charges.
- Any other paid API, license, storage, CDN, monitoring or external service required by the project.

## Phase-2 / Advanced Features Not Included Unless Separately Agreed
- Advanced live-exam monitoring at large scale.
- Advanced weekly/monthly/category leaderboards and complex tie-breaking UI.
- Full dynamic website CMS for every visual section.
- Advanced bulk Excel/CSV question import with detailed validation/reporting.
- Advanced analytics dashboards and exports.
- Full invoice/receipt/accounting features.
- Deep links/app links.
- Large-scale caching/queue tuning and load optimization.
- Automated disaster-recovery implementation and full DR documentation.
- Penetration testing / advanced security audit.
- iOS application.
- Long-term maintenance or new modules outside agreed scope.

## Scope Change Rule
- Any feature not specifically listed in the agreed Phase-1 scope is additional work.
- New requirements or major workflow changes after development begins may require additional cost and timeline.
- Small UI/text corrections within agreed screens may be handled during normal review.
