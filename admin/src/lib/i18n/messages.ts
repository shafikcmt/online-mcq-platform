/** Admin Panel UI strings. English is the default (docs/LOCALIZATION.md); Bangla is kept
 * complete so the panel can switch languages. Keys are stable; never build strings by
 * concatenating translated fragments. */
import { attemptBn, attemptEn } from "./attempt-messages";
import { auditBn, auditEn } from "./audit-messages";
import { cmsBn, cmsEn } from "./cms-messages";
import { gatewayBn, gatewayEn } from "./gateway-messages";
import { questionImportBn, questionImportEn } from "./question-import-messages";
import { materialsBn, materialsEn } from "./materials-messages";
import { noticePdfBn, noticePdfEn } from "./notice-pdf-messages";
import { sampleBn, sampleEn } from "./sample-messages";
import { pushBn, pushEn } from "./push-messages";
import { routineBn, routineEn } from "./routine-messages";
import { syllabusBn, syllabusEn } from "./syllabus-messages";
import { smsBn, smsEn } from "./sms-messages";
import { contentBn, contentEn } from "./content-messages";
import { packageBn, packageEn } from "./package-messages";
import { paymentBn, paymentEn } from "./payment-messages";
import { examBn, examEn } from "./exam-messages";
import { resultBn, resultEn } from "./result-messages";
import { userBn, userEn } from "./user-messages";

const coreEn = {
  "brand.name": "Live Model Test",
  "brand.area": "Admin",
  "nav.overview": "Overview",
  "nav.dashboard": "Dashboard",
  "nav.people": "People",
  "nav.users": "Users",
  "nav.subscriptions": "Subscriptions",
  "nav.content": "Content",
  "nav.categories": "Categories",
  "nav.questions": "Questions",
  "nav.exams": "Exams",
  "nav.attempts": "Attempts",
  "nav.results": "Results",
  "nav.commerce": "Commerce",
  "nav.packages": "Packages",
  "nav.payments": "Payments",
  "nav.site": "Site",
  "nav.announcements": "Announcements",
  "nav.faq": "FAQ",
  "nav.pages": "Pages",
  "nav.contact": "Contact messages",
  "nav.settings": "Site settings",
  "nav.system": "System",
  "nav.audit": "Audit log",
  "nav.soon": "Soon",
  "nav.soonHint": "Built in the next Admin Panel step",
  "nav.open": "Open navigation",
  "nav.close": "Close navigation",
  "nav.collapse": "Collapse sidebar",
  "nav.expand": "Expand sidebar",
  "nav.main": "Main navigation",
  "nav.skip": "Skip to content",
  "nav.drawerHint": "Choose a section of the admin panel.",
  "nav.pendingNote": "Dimmed sections are not built yet. They are added in the next Admin Panel steps.",
  "common.loading": "Loading…",
  "error.server": "The server couldn't complete this request. Please try again in a moment.",
  "error.network": "Can't reach the server. Check your connection and try again.",
  "error.timeout": "The server took too long to respond. Please try again.",
  "error.unauthenticated": "Your session has ended. Please sign in again.",
  "error.rateLimited": "Too many attempts. Please wait a while and try again.",
  "error.generic": "Something went wrong. Please try again.",
  "session.expiredTitle": "Your session has ended",
  "session.expiredBody": "For your security you were signed out. Sign in again to continue — you'll come back to this page. Changes you haven't saved here will be lost, so copy anything you need first.",
  "session.signIn": "Sign in again",
  "session.stay": "Stay on this page",
  "user.menu": "Account menu",
  "user.signOut": "Sign out",
  "user.signingOut": "Signing out…",
  "lang.label": "Language",
  "lang.en": "English",
  "lang.bn": "বাংলা",
  "login.title": "Sign in to the admin panel",
  "login.subtitle": "Use your admin mobile number and password.",
  "login.mobile": "Mobile number",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.submitting": "Signing in…",
  "login.required": "This field is required.",
  "login.expired": "Your session has ended. Please sign in again.",
  "login.footer": "Only administrators can sign in here. Students use the mobile app.",
  "common.retry": "Try again",
  "common.updated": "Updated",
  "error.title": "Couldn't load this page",
  "error.forbidden": "You don't have permission to view this page.",
  "dashboard.title": "Dashboard",
  "dashboard.subtitle": "Today at a glance. Times follow the {tz} calendar.",
  "dashboard.students": "Students",
  "dashboard.studentsActive": "{n} active {n|account|accounts}",
  "dashboard.attemptsToday": "Attempts today",
  "dashboard.attemptsTodaySub": "{submitted} submitted · {inProgress} in progress now",
  "dashboard.activeSubs": "Active subscriptions",
  "dashboard.activeSubsSub": "{n} {n|student|students} with access",
  "dashboard.revenue": "Revenue this month",
  "dashboard.revenueSub": "{n} successful {n|payment|payments}",
  "dashboard.revenueNone": "No successful payments yet",
  "dashboard.exams": "Exams",
  "dashboard.examsTotal": "{n} {n|exam|exams} in total",
  "dashboard.openNow": "Open now",
  "dashboard.upcoming": "Upcoming",
  "dashboard.payments": "Payments by status",
  "dashboard.paymentsTotal": "{n} {n|payment|payments} in total",
  "dashboard.paymentsNote": "All-time counts. Only provider-verified payments are successful.",
  "dashboard.empty": "No data yet",
  "dashboard.recentExams": "Recent exams",
  "dashboard.recentExamsHint": "The five most recently created exams.",
  "dashboard.allExams": "All exams",
  "dashboard.recentExamsEmpty": "No exams yet. Create the first one to see it here.",
  "dashboard.recentExamsUnavailable": "Recent exams can't be loaded right now. Reload the page to try again.",
  "status.draft": "Draft",
  "status.published": "Published",
  "status.unpublished": "Unpublished",
  "status.archived": "Archived",
  "status.initiated": "Initiated",
  "status.pending": "Pending",
  "status.success": "Successful",
  "status.failed": "Failed",
  "status.cancelled": "Cancelled",
};

export const en = { ...coreEn, ...contentEn, ...examEn, ...resultEn, ...userEn, ...attemptEn, ...packageEn, ...paymentEn, ...cmsEn, ...auditEn, ...smsEn, ...gatewayEn, ...questionImportEn, ...syllabusEn, ...routineEn, ...noticePdfEn, ...materialsEn, ...sampleEn, ...pushEn };

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

const coreBn: Record<keyof typeof coreEn, string> = {
  "brand.name": "লাইভ মডেল টেস্ট",
  "brand.area": "অ্যাডমিন",
  "nav.overview": "সারসংক্ষেপ",
  "nav.dashboard": "ড্যাশবোর্ড",
  "nav.people": "ব্যবহারকারী",
  "nav.users": "ব্যবহারকারীরা",
  "nav.subscriptions": "সাবস্ক্রিপশন",
  "nav.content": "কনটেন্ট",
  "nav.categories": "ক্যাটাগরি",
  "nav.questions": "প্রশ্ন",
  "nav.exams": "পরীক্ষা",
  "nav.attempts": "প্রচেষ্টা",
  "nav.results": "ফলাফল",
  "nav.commerce": "বিক্রয়",
  "nav.packages": "প্যাকেজ",
  "nav.payments": "পেমেন্ট",
  "nav.site": "সাইট",
  "nav.announcements": "ঘোষণা",
  "nav.faq": "প্রশ্নোত্তর",
  "nav.pages": "পেজ",
  "nav.contact": "যোগাযোগ বার্তা",
  "nav.settings": "সাইট সেটিংস",
  "nav.system": "সিস্টেম",
  "nav.audit": "অডিট লগ",
  "nav.soon": "শীঘ্রই",
  "nav.soonHint": "অ্যাডমিন প্যানেলের পরের ধাপে তৈরি হবে",
  "nav.open": "নেভিগেশন খুলুন",
  "nav.close": "নেভিগেশন বন্ধ করুন",
  "nav.collapse": "সাইডবার ছোট করুন",
  "nav.expand": "সাইডবার বড় করুন",
  "nav.main": "প্রধান নেভিগেশন",
  "nav.skip": "মূল কনটেন্টে যান",
  "nav.drawerHint": "অ্যাডমিন প্যানেলের একটি অংশ বেছে নিন।",
  "nav.pendingNote": "হালকা রঙের অংশগুলো এখনও তৈরি হয়নি। অ্যাডমিন প্যানেলের পরের ধাপগুলোতে যুক্ত হবে।",
  "common.loading": "লোড হচ্ছে…",
  "error.server": "সার্ভার অনুরোধটি সম্পন্ন করতে পারেনি। একটু পরে আবার চেষ্টা করুন।",
  "error.network": "সার্ভারে সংযোগ করা যাচ্ছে না। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।",
  "error.timeout": "সার্ভার সাড়া দিতে বেশি সময় নিয়েছে। আবার চেষ্টা করুন।",
  "error.unauthenticated": "আপনার সেশন শেষ হয়েছে। আবার সাইন ইন করুন।",
  "error.rateLimited": "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন।",
  "error.generic": "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।",
  "session.expiredTitle": "আপনার সেশন শেষ হয়েছে",
  "session.expiredBody": "নিরাপত্তার জন্য আপনাকে সাইন আউট করা হয়েছে। চালিয়ে যেতে আবার সাইন ইন করুন — আপনি এই পেজেই ফিরে আসবেন। এখানে সংরক্ষণ না করা পরিবর্তনগুলো হারিয়ে যাবে, তাই দরকারি কিছু থাকলে আগে কপি করে নিন।",
  "session.signIn": "আবার সাইন ইন করুন",
  "session.stay": "এই পেজেই থাকুন",
  "user.menu": "অ্যাকাউন্ট মেনু",
  "user.signOut": "সাইন আউট",
  "user.signingOut": "সাইন আউট হচ্ছে…",
  "lang.label": "ভাষা",
  "lang.en": "English",
  "lang.bn": "বাংলা",
  "login.title": "অ্যাডমিন প্যানেলে সাইন ইন করুন",
  "login.subtitle": "আপনার অ্যাডমিন মোবাইল নম্বর ও পাসওয়ার্ড ব্যবহার করুন।",
  "login.mobile": "মোবাইল নম্বর",
  "login.password": "পাসওয়ার্ড",
  "login.submit": "সাইন ইন",
  "login.submitting": "সাইন ইন হচ্ছে…",
  "login.required": "এই ঘরটি পূরণ করা আবশ্যক।",
  "login.expired": "আপনার সেশন শেষ হয়েছে। আবার সাইন ইন করুন।",
  "login.footer": "এখানে শুধু অ্যাডমিনরা সাইন ইন করতে পারেন। শিক্ষার্থীরা মোবাইল অ্যাপ ব্যবহার করেন।",
  "common.retry": "আবার চেষ্টা করুন",
  "common.updated": "হালনাগাদ",
  "error.title": "পেজটি লোড করা যায়নি",
  "error.forbidden": "এই পেজ দেখার অনুমতি আপনার নেই।",
  "dashboard.title": "ড্যাশবোর্ড",
  "dashboard.subtitle": "আজকের সারসংক্ষেপ। সময় {tz} অনুযায়ী।",
  "dashboard.students": "শিক্ষার্থী",
  "dashboard.studentsActive": "{n}টি সক্রিয় অ্যাকাউন্ট",
  "dashboard.attemptsToday": "আজকের পরীক্ষা",
  "dashboard.attemptsTodaySub": "{submitted}টি জমা · এখন চলছে {inProgress}টি",
  "dashboard.activeSubs": "সক্রিয় সাবস্ক্রিপশন",
  "dashboard.activeSubsSub": "{n} জন শিক্ষার্থীর অ্যাক্সেস আছে",
  "dashboard.revenue": "এই মাসের আয়",
  "dashboard.revenueSub": "{n}টি সফল পেমেন্ট",
  "dashboard.revenueNone": "এখনও কোনো সফল পেমেন্ট নেই",
  "dashboard.exams": "পরীক্ষা",
  "dashboard.examsTotal": "মোট {n}টি পরীক্ষা",
  "dashboard.openNow": "এখন চলছে",
  "dashboard.upcoming": "আসন্ন",
  "dashboard.payments": "স্ট্যাটাস অনুযায়ী পেমেন্ট",
  "dashboard.paymentsTotal": "মোট {n}টি পেমেন্ট",
  "dashboard.paymentsNote": "সব সময়ের হিসাব। শুধু প্রোভাইডার-যাচাইকৃত পেমেন্টই সফল ধরা হয়।",
  "dashboard.empty": "এখনও কোনো তথ্য নেই",
  "dashboard.recentExams": "সাম্প্রতিক পরীক্ষা",
  "dashboard.recentExamsHint": "সবচেয়ে সম্প্রতি তৈরি পাঁচটি পরীক্ষা।",
  "dashboard.allExams": "সব পরীক্ষা",
  "dashboard.recentExamsEmpty": "এখনও কোনো পরীক্ষা নেই। প্রথমটি তৈরি করলে এখানে দেখা যাবে।",
  "dashboard.recentExamsUnavailable": "সাম্প্রতিক পরীক্ষা এখন লোড করা যাচ্ছে না। আবার চেষ্টা করতে পাতাটি রিলোড করুন।",
  "status.draft": "খসড়া",
  "status.published": "প্রকাশিত",
  "status.unpublished": "অপ্রকাশিত",
  "status.archived": "আর্কাইভ",
  "status.initiated": "শুরু হয়েছে",
  "status.pending": "অপেক্ষমাণ",
  "status.success": "সফল",
  "status.failed": "ব্যর্থ",
  "status.cancelled": "বাতিল",
};

export const bn: Messages = { ...coreBn, ...contentBn, ...examBn, ...resultBn, ...userBn, ...attemptBn, ...packageBn, ...paymentBn, ...cmsBn, ...auditBn, ...smsBn, ...gatewayBn, ...questionImportBn, ...syllabusBn, ...routineBn, ...noticePdfBn, ...materialsBn, ...sampleBn, ...pushBn };

export const LOCALES = ["en", "bn"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const MESSAGES: Record<Locale, Messages> = { en, bn };

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "en" || value === "bn";
}

/** `{name}` is replaced by `vars.name`. `{name|one|other}` picks a word by count for English
 * plurals ("{n} {n|student|students}"); Bangla nouns do not change, so Bangla text never
 * needs it. */
export function translate(
  messages: Messages,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const template = messages[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template
    .replace(/\{(\w+)\|([^|{}]*)\|([^|{}]*)\}/g, (_, name: string, one: string, other: string) =>
      Number(vars[name]) === 1 ? one : other,
    )
    .replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}
