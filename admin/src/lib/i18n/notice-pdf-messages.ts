/** Notice PDF (Admin Panel): the optional PDF attached to an announcement, managed in the
 * announcement dialog through /api/v1/admin/announcements/<id>/pdf/. Upload errors reuse the
 * `rt.err.*` messages (same server rules as the routine PDF). */
export const noticePdfEn = {
  "np.title": "PDF attachment",
  "np.hint": "Optional. Students and visitors can open this PDF from the notice. PDF only, up to {mb} MB; files with scripts are refused.",
  "np.saveFirst": "Save the announcement first, then you can attach a PDF.",
  "np.none": "No PDF attached.",
  "np.current": "Attached: {name}",
  "np.upload": "Attach PDF",
  "np.replace": "Replace PDF",
  "np.uploading": "Uploading…",
  "np.open": "Open PDF",
  "np.remove": "Remove PDF",
  "np.removing": "Removing…",
  "np.removeTitle": "Remove the PDF?",
  "np.removeBody": "The notice stays, but its PDF is deleted and can no longer be opened.",
  "np.uploaded": "PDF attached.",
  "np.removed": "PDF removed.",
};

export const noticePdfBn: typeof noticePdfEn = {
  "np.title": "PDF সংযুক্তি",
  "np.hint": "ঐচ্ছিক। শিক্ষার্থী ও দর্শক নোটিশ থেকে এই PDF খুলতে পারবেন। শুধু PDF, সর্বোচ্চ {mb} MB; স্ক্রিপ্ট থাকলে গ্রহণ করা হবে না।",
  "np.saveFirst": "আগে ঘোষণাটি সেভ করুন, তারপর PDF সংযুক্ত করতে পারবেন।",
  "np.none": "কোনো PDF সংযুক্ত নেই।",
  "np.current": "সংযুক্ত: {name}",
  "np.upload": "PDF সংযুক্ত করুন",
  "np.replace": "PDF বদলান",
  "np.uploading": "আপলোড হচ্ছে…",
  "np.open": "PDF খুলুন",
  "np.remove": "PDF সরান",
  "np.removing": "সরানো হচ্ছে…",
  "np.removeTitle": "PDF সরাবেন?",
  "np.removeBody": "নোটিশ থাকবে, কিন্তু এর PDF মুছে যাবে এবং আর খোলা যাবে না।",
  "np.uploaded": "PDF সংযুক্ত হয়েছে।",
  "np.removed": "PDF সরানো হয়েছে।",
};
