// Dates in tests are checked as text: run every test in one fixed time zone (the
// platform's own, Asia/Dhaka, UTC+6 with no daylight saving).
module.exports = async () => {
  process.env.TZ = "Asia/Dhaka";
};
