/* ============================================
   Kanisa Hub — Language switcher (SW / EN)

   Include once per page, right before </body>:
     <script src="../assets/js/i18n.js"></script>

   Pages are written mostly in English (some in
   Swahili). This script keeps every text node's
   original wording and swaps in the dictionary
   translation for the chosen language, including
   text that page scripts render later (tables,
   toasts…) via a MutationObserver.

   Add new phrases to EN2SW below — the reverse
   (Swahili → English) is derived automatically.
   Mark anything that must never be translated
   with the data-no-i18n attribute.
   ============================================ */
(function () {
  const STORE_KEY = 'kh-lang';

  /* ── Dictionary: English → Kiswahili ── */
  const EN2SW = {
    // navigation & layout
    'Dashboard': 'Dashibodi', 'Members': 'Washirika', 'Contributions': 'Michango', 'Events': 'Matukio',
    'Announcements': 'Matangazo', 'Media': 'Media', 'Homepage': 'Ukurasa wa Mwanzo', 'Sermons': 'Mahubiri',
    'Reports': 'Ripoti', 'Departments': 'Idara', 'Group Chat': 'Mazungumzo ya Kikundi',
    'Group Chats': 'Mazungumzo ya Vikundi', 'My Profile': 'Wasifu Wangu', 'My Church Life': 'Maisha Yangu Kanisani',
    'Member Dashboard': 'Dashibodi ya Mshirika', 'Admin Dashboard': 'Dashibodi ya Admin', 'My Dashboard': 'Dashibodi Yangu',
    'Logout': 'Toka', 'Sign Out': 'Toka', 'Admin Portal': 'Lango la Admin', 'Member Portal': 'Lango la Mshirika',
    'Main Menu': 'Menyu Kuu', 'Account': 'Akaunti', 'My Giving': 'Matoleo Yangu', 'Media Gallery': 'Picha na Video',
    'Home': 'Nyumbani', 'Giving': 'Matoleo', 'More': 'Zaidi', 'System': 'Mfumo', 'Church Data': 'Taarifa za Kanisa',
    'System Overview': 'Muhtasari wa Mfumo', 'Manage Admins': 'Simamia Admins', 'Admins': 'Admins',
    'Roles & Permissions': 'Majukumu na Ruhusa', 'Settings': 'Mipangilio', 'Church Settings': 'Mipangilio ya Kanisa',
    'All Departments': 'Idara Zote', 'All departments': 'Idara zote', 'All Members': 'Washirika Wote',
    'All Contributions': 'Michango Yote', 'All Events': 'Matukio Yote', 'All Announcements': 'Matangazo Yote',
    'All Media': 'Media Zote', 'All Sermons': 'Mahubiri Yote', 'All Group Chats': 'Mazungumzo Yote ya Vikundi',
    'Full Reports': 'Ripoti Kamili', 'Super Admin': 'Super Admin', 'Admin': 'Admin', 'Member': 'Mshirika',
    'Administrator': 'Msimamizi', 'Member Profile': 'Wasifu wa Mshirika', 'Notifications': 'Taarifa',
    'View church website': 'Tazama tovuti ya kanisa', 'All rights reserved': 'Haki zote zimehifadhiwa',
    'Powered by': 'Imewezeshwa na',

    // generic actions
    'Cancel': 'Ghairi', 'Save': 'Hifadhi', 'Save Changes': 'Hifadhi Mabadiliko', 'Save All Changes': 'Hifadhi Mabadiliko Yote',
    'Save Settings': 'Hifadhi Mipangilio', 'Edit': 'Hariri', 'Delete': 'Futa', 'Remove': 'Ondoa', 'Add': 'Ongeza',
    'Search': 'Tafuta', 'Export': 'Pakua', 'Export Report': 'Pakua Ripoti', 'View': 'Angalia', 'View All': 'Ona Yote',
    'View Details': 'Angalia Maelezo', 'Next': 'Inayofuata', 'Previous': 'Iliyopita', 'Back': 'Rudi',
    'Continue': 'Endelea', 'Update': 'Sasisha', 'Publish': 'Chapisha', 'Upload File': 'Pakia Faili',
    'Upload Media': 'Pakia Media', 'Download': 'Pakua', 'Reset': 'Weka Upya', 'Reset Filters': 'Ondoa Vichujio',
    'Refresh Dashboard': 'Onyesha Upya', 'Load More': 'Pakia Zaidi', 'Select': 'Chagua', 'Change': 'Badilisha',
    'Preview': 'Hakiki', 'Close': 'Funga', 'Dismiss': 'Funga', 'Send': 'Tuma', 'Send Email': 'Tuma Barua Pepe',
    'Edit Profile': 'Hariri Wasifu', 'Deactivate': 'Zima', 'Loading…': 'Inapakia…', 'Loading...': 'Inapakia...',
    'Yes': 'Ndio', 'No': 'Hapana', 'Welcome': 'Karibu', 'Welcome back': 'Karibu tena', 'Thank you': 'Asante',

    // table headers, labels, statuses
    'Status': 'Hali', 'Actions': 'Vitendo', 'Action': 'Kitendo', 'Date': 'Tarehe', 'Amount': 'Kiasi', 'Type': 'Aina',
    'Category': 'Kategoria', 'Categories': 'Kategoria', 'Title': 'Kichwa', 'Description': 'Maelezo',
    'Location': 'Mahali', 'Phone': 'Simu', 'Email': 'Barua Pepe', 'Full Name': 'Jina Kamili', 'Department': 'Idara',
    'Role': 'Jukumu', 'Joined': 'Alijiunga', 'Notes': 'Maelezo', 'Method / Status': 'Njia / Hali', 'Scope': 'Wigo',
    'Priority': 'Kipaumbele', 'Visibility': 'Mwonekano', 'Target': 'Walengwa', 'Content': 'Maudhui', 'Speaker': 'Mhubiri',
    'Active': 'Hai', 'Inactive': 'Si Hai', 'Pending': 'Inasubiri', 'Suspended': 'Imesimamishwa', 'Upcoming': 'Yajayo',
    'Past': 'Yaliyopita', 'Draft': 'Rasimu', 'Drafts': 'Rasimu', 'Published': 'Imechapishwa', 'Expired': 'Imeisha Muda',
    'Completed': 'Imekamilika', 'Urgent': 'Muhimu Sana', 'General': 'Jumla', 'Public': 'Umma', 'Private': 'Binafsi',
    'Total': 'Jumla', 'This Month': 'Mwezi Huu', 'This month': 'Mwezi huu', 'This Week': 'Wiki Hii', 'This Year': 'Mwaka Huu',
    'All': 'Zote', 'All Time': 'Muda Wote', 'All time': 'Muda wote', 'All Status': 'Hali Zote', 'All Statuses': 'Hali Zote',
    'All statuses': 'Hali zote', 'All Roles': 'Majukumu Yote', 'All Types': 'Aina Zote', 'All types': 'Aina zote',
    'All Categories': 'Kategoria Zote', 'Unassigned': 'Haijapangiwa', 'None': 'Hakuna', 'New': 'Mpya', 'Live': 'Mubashara',
    'Male': 'Mwanaume', 'Female': 'Mwanamke', 'Gender': 'Jinsia', 'Date of Birth': 'Tarehe ya Kuzaliwa',
    'Marital Status': 'Hali ya Ndoa', 'Single': 'Hajaoa/Hajaolewa', 'Married': 'Ameoa/Ameolewa', 'Address': 'Anwani',
    'Password': 'Nenosiri', 'Confirm Password': 'Thibitisha Nenosiri', 'New Password': 'Nenosiri Jipya',
    'Phone Number': 'Namba ya Simu', 'Email Address': 'Barua Pepe', 'Member Since': 'Mshirika Tangu',

    // giving
    'Tithe': 'Zaka', 'Offering': 'Sadaka', 'Building Fund': 'Mfuko wa Ujenzi', 'Building': 'Ujenzi',
    'Thanksgiving': 'Shukrani', 'Special': 'Maalum', 'Other': 'Nyingine', 'Total Contributions': 'Jumla ya Michango',
    'Monthly Total': 'Jumla ya Mwezi', 'Entries': 'Rekodi', 'Most Used Type': 'Aina Inayotumika Zaidi',
    'Contribution Records': 'Kumbukumbu za Michango', 'Contribution Types': 'Aina za Michango',
    'Record New Contribution': 'Rekodi Mchango Mpya', 'View Monthly Summary': 'Muhtasari wa Mwezi',
    'Export Department Report': 'Pakua Ripoti ya Idara', 'New Contribution': 'Mchango Mpya',
    'Recent Contributions': 'Michango ya Karibuni', 'Monthly Giving': 'Matoleo ya Mwezi', 'Total Given': 'Jumla Uliyotoa',
    'Transactions': 'Miamala', 'Largest Gift': 'Toleo Kubwa Zaidi', 'Total Offerings': 'Jumla ya Matoleo',
    'Giving Summary': 'Muhtasari wa Matoleo', 'My Giving History': 'Historia ya Matoleo Yangu',
    'Contribution History': 'Historia ya Michango', 'Giving by Type': 'Matoleo kwa Aina', 'Top Type': 'Aina ya Juu',
    'Total Received': 'Jumla Iliyopokelewa', 'Stewardship': 'Uwakili', 'Toa Sasa / Give Now': 'Toa Sasa',
    'Detailed financial records': 'Kumbukumbu za fedha kwa kina', 'View Contributions': 'Angalia Michango',
    'Filter and review all visible contribution entries.': 'Chuja na pitia michango yote inayoonekana.',
    'Manage department giving records, totals, and recent transactions.': 'Simamia michango ya idara, jumla na miamala ya karibuni.',
    'Every giving record across all departments and members.': 'Kila mchango kutoka idara na washirika wote.',

    // dashboard
    'Quick Actions': 'Vitendo vya Haraka', 'Recent Activity': 'Shughuli za Karibuni', 'Total Members': 'Jumla ya Washirika',
    'New Registrations': 'Usajili Mpya', 'Upcoming Events': 'Matukio Yajayo', 'Last 6 months': 'Miezi 6 iliyopita',
    'Add Member': 'Ongeza Mshirika', 'Register a new family or individual': 'Sajili familia au mtu mpya',
    'Post Announcement': 'Tuma Tangazo', 'Broadcast to all or a department': 'Tangaza kwa wote au kwa idara',
    'Welcome back. Here is what\'s happening today.': 'Karibu tena. Haya ndiyo yanayoendelea leo.',
    'Here is what\'s happening today.': 'Haya ndiyo yanayoendelea leo.', 'Member Growth': 'Ukuaji wa Washirika',
    'New registrations per month': 'Usajili mpya kwa mwezi', 'All Systems Operational': 'Mifumo Yote Inafanya Kazi',
    'Monitor the health and activity of the entire church platform.': 'Fuatilia hali na shughuli za mfumo mzima wa kanisa.',
    'Good morning': 'Habari za asubuhi', 'Good afternoon': 'Habari za mchana', 'Good evening': 'Habari za jioni',
    'Good day!': 'Siku njema!', 'Active Members': 'Washirika Hai', 'New This Month': 'Wapya Mwezi Huu',
    'New Members': 'Washirika Wapya', 'Department Distribution': 'Mgawanyo wa Idara', 'Admin Registry': 'Orodha ya Admins',
    'Create, edit roles & permissions': 'Unda na hariri majukumu na ruhusa', 'System Settings': 'Mipangilio ya Mfumo',

    // members
    'Member List': 'Orodha ya Washirika', 'Members Directory': 'Orodha ya Washirika', 'Member Directory': 'Orodha ya Washirika',
    'Add New Member': 'Ongeza Mshirika Mpya', 'Search members...': 'Tafuta washirika...', 'View Profile': 'Angalia Wasifu',
    'No members found': 'Hakuna washirika waliopatikana', 'Leadership': 'Uongozi', 'Stewardship Dashboard': 'Dashibodi ya Uwakili',
    'Stewardship Portal': 'Lango la Uwakili', 'Search name, email, phone…': 'Tafuta jina, barua pepe, simu…',
    'Every member across all departments': 'Kila mshirika kutoka idara zote', 'Church-Wide Access': 'Ufikiaji wa Kanisa Zima',
    'Department Scope': 'Wigo wa Idara', 'Personal Information': 'Taarifa Binafsi',
    'Update your name, phone, and contact details.': 'Sasisha jina, simu na mawasiliano yako.',
    'Manage your personal information and account settings.': 'Simamia taarifa zako binafsi na mipangilio ya akaunti.',
    'Manage your personal information and account details.': 'Simamia taarifa zako binafsi na akaunti.',
    'Change Password': 'Badilisha Nenosiri', 'Update Password': 'Sasisha Nenosiri', 'Security': 'Usalama',
    'My Department': 'Idara Yangu', 'No Department Assigned': 'Hujapangiwa Idara',
    'Total Admins': 'Jumla ya Admins', 'Add Admin': 'Ongeza Admin', 'Active Admins': 'Admins Hai',
    'Create, review and manage administrator accounts.': 'Unda, pitia na simamia akaunti za wasimamizi.',
    'Edit module access and department scope for admins.': 'Hariri ruhusa na wigo wa idara kwa admins.',
    'Search admins by name or email…': 'Tafuta admin kwa jina au barua pepe…',

    // events / announcements / sermons / media / departments
    'Create Event': 'Unda Tukio', 'Event List': 'Orodha ya Matukio', 'Events & Fellowship': 'Matukio na Ushirika',
    'Past Events': 'Matukio Yaliyopita', 'Coming Up': 'Yanayokuja', 'View Calendar': 'Angalia Kalenda',
    'Calendar View': 'Mwonekano wa Kalenda', 'Export Event List': 'Pakua Orodha ya Matukio', 'Start Date': 'Tarehe ya Kuanza',
    'End Date': 'Tarehe ya Mwisho', 'No events found': 'Hakuna matukio', 'No upcoming events': 'Hakuna matukio yajayo',
    'New Announcement': 'Tangazo Jipya', 'Pinned Message': 'Ujumbe Uliobandikwa', 'Expires At': 'Inaisha',
    'Add Sermon': 'Ongeza Hubiri', 'Save Sermon': 'Hifadhi Hubiri', 'Sermon Library': 'Maktaba ya Mahubiri',
    'Sermon Date': 'Tarehe ya Hubiri', 'Series Name': 'Jina la Mfululizo', 'Scripture Reference': 'Andiko la Biblia',
    'No sermons found': 'Hakuna mahubiri', 'Now Playing': 'Inacheza Sasa', 'Audio': 'Sauti',
    'New Department': 'Idara Mpya', 'Add Department': 'Ongeza Idara', 'Create Department': 'Unda Idara',
    'Ministry Structure': 'Muundo wa Huduma', 'Ministry Management': 'Usimamizi wa Huduma',
    'Media Library': 'Maktaba ya Media', 'Media Items': 'Vipengele vya Media',
    'Select a Group': 'Chagua Kikundi', 'Type a message…': 'Andika ujumbe…', 'All Groups': 'Vikundi Vyote',
    'Church Identity': 'Utambulisho wa Kanisa', 'Church Name': 'Jina la Kanisa', 'Church Logo': 'Nembo ya Kanisa',
    'Contact Information': 'Taarifa za Mawasiliano', 'Tagline': 'Kauli Mbiu',
    'Configure church-wide identity and contact information.': 'Weka utambulisho na mawasiliano ya kanisa.',
    'Department performance summary — members, giving, and activity.': 'Muhtasari wa idara — washirika, matoleo na shughuli.',
    'Recent Member Registrations': 'Usajili wa Karibuni', 'Membership': 'Uanachama',
    'Showing': 'Inaonyesha', 'Records': 'Rekodi', 'Summary': 'Muhtasari', 'Total Records': 'Jumla ya Rekodi',
    'Search member, reference, payment method...': 'Tafuta mshirika, kumbukumbu, njia ya malipo...',
    'Search member, reference...': 'Tafuta mshirika, kumbukumbu...', 'Search events…': 'Tafuta matukio…',
    'Search announcements…': 'Tafuta matangazo…', 'Search sermons…': 'Tafuta mahubiri…', 'Search departments…': 'Tafuta idara…',
    'Search title or location': 'Tafuta kichwa au mahali', 'Search groups…': 'Tafuta vikundi…', 'Search…': 'Tafuta…',
    'Total Events': 'Jumla ya Matukio', 'Total Sermons': 'Jumla ya Mahubiri', 'Monthly Events': 'Matukio ya Mwezi',
    'Department Events': 'Matukio ya Idara', 'Church-Wide Events': 'Matukio ya Kanisa Zima', 'Soon': 'Karibuni',
    'Upcoming Highlights': 'Yanayokuja Karibuni', 'Manage Events': 'Simamia Matukio', 'Event': 'Tukio',
    'Try adjusting your filters.': 'Jaribu kubadilisha vichujio.', 'No contributions found': 'Hakuna michango',
    'Recent Registrations': 'Usajili wa Karibuni', 'Total Giving': 'Jumla ya Matoleo', 'News': 'Habari',

    // public website
    'Services': 'Ibada', 'About': 'Kuhusu', 'Contact': 'Mawasiliano', 'Login': 'Ingia', 'Join Us': 'Jiunge Nasi',
    'Become a Member': 'Kuwa Mshirika', 'Service Times': 'Ratiba za Ibada', 'Welcome to': 'Karibu',
    'Hundreds of members already in the sanctuary': 'Mamia ya washirika tayari wako nasi',
    'Weekly Gatherings': 'Ibada za Kila Wiki', 'Gather With Us': 'Kusanyika Nasi',
    'Insights & Announcements': 'Habari na Matangazo', 'Our Ministries': 'Huduma Zetu', 'Join Ministry': 'Jiunge na Huduma',
    'Join Our Community': 'Jiunge na Jumuiya Yetu', 'Quick Links': 'Viungo vya Haraka', 'Visit Us': 'Tutembelee',
    'Our Story': 'Historia Yetu', 'Get Started': 'Anza Sasa', 'Fellowship & Growth': 'Ushirika na Ukuaji',
    'Start your journey into our community today.': 'Anza safari yako katika jumuiya yetu leo.',
    'Join Bible study, prayer groups, and youth programs throughout the week.': 'Jiunge na mafundisho ya Biblia, vikundi vya maombi na programu za vijana kila wiki.',
    'View Events →': 'Angalia Matukio →', 'Enter Sanctuary': 'Ingia Kanisani', 'EVERY WEEK': 'KILA WIKI',
    'Sunday': 'Jumapili', 'Saturday': 'Jumamosi', 'Morning Service': 'Ibada ya Asubuhi', 'Youth': 'Vijana',
    'Women': 'Wanawake', 'Men': 'Wanaume', 'Missions': 'Misheni', 'Outreach': 'Uinjilisti', 'Community': 'Jamii',
    'The Latest': 'Habari Mpya', 'Create Account': 'Fungua Akaunti', 'Sign In': 'Ingia',
    'Request Membership': 'Omba Uanachama', 'New Here?': 'Mgeni Hapa?', 'Remember me': 'Nikumbuke',
    '← Back to Homepage': '← Rudi Ukurasa wa Mwanzo', 'Sign in to your Kanisa Hub portal': 'Ingia kwenye lango lako la Kanisa Hub',
    'Already have an account?': 'Una akaunti tayari?', 'Join The Sanctuary': 'Jiunge na Kanisa',
    'Create your Kanisa Hub member account': 'Fungua akaunti yako ya mshirika wa Kanisa Hub',
    'Enter your full name': 'Andika jina lako kamili', 'Enter your password': 'Andika nenosiri lako',
    'Min 6 characters': 'Angalau herufi 6', 'Repeat password': 'Rudia nenosiri', 'Invalid email or password.': 'Barua pepe au nenosiri si sahihi.',
    'Your church,': 'Kanisa lako,', 'connected.': 'limeunganishwa.',
    'Giving, sermons, events and fellowship for the whole congregation, together in one place.': 'Matoleo, mahubiri, matukio na ushirika kwa kanisa zima, mahali pamoja.',
    'Give with ease': 'Toa kwa urahisi', 'Tithes and offerings via mobile money': 'Zaka na sadaka kwa pesa ya simu',
    'Never miss the Word': 'Usikose Neno', 'Sermons and announcements anytime': 'Mahubiri na matangazo wakati wowote',
    'Stay close to your ministry': 'Kaa karibu na huduma yako', 'Events and group chats for every department': 'Matukio na mazungumzo kwa kila idara',

    // phrases whose source text is Swahili (shown in English when EN is chosen)
    'Welcome Home': 'Karibu Nyumbani', 'Latest News': 'Habari Mpya',
    'A community of faith, love and service — now digital.': 'Jumuiya ya imani, upendo na huduma — sasa kidijitali.',
    'Is this your first time worshipping with us?': 'Je, ni mara ya kwanza kuabudu kanisani kwetu?',
    'Would you like us to keep in touch?': 'Je, ungependa tuendelee kuwasiliana nawe?',
    'We are glad to meet you. Please fill in your details below.': 'Tunafurahi kukujua. Tafadhali jaza taarifa zako hapa chini.',
    'Where you live (Area/Street)': 'Unapoishi (Eneo/Mtaa)', 'Full name': 'Jina kamili', 'Phone number': 'Namba ya simu',
    'We have received your details. God bless you!': 'Tumepokea taarifa zako. Mungu akubariki!',
    'Please choose Yes or No.': 'Tafadhali chagua Ndio au Hapana.', 'Payment Successful': 'Malipo Yamefanikiwa',
    'Payment Failed': 'Malipo Hayakufaulu', 'Try Again': 'Jaribu Tena', 'Back Home': 'Rudi Nyumbani',
    'Page Not Found': 'Ukurasa Haukupatikana', 'Something Went Wrong': 'Kuna Tatizo',
    'Back to Contribution History': 'Rudi Historia ya Michango', 'Checking Payment…': 'Inakagua Malipo…',
    'Demo Accounts · Click to sign in · Password: Demo@2026': 'Akaunti za Demo · Bonyeza kuingia · Password: Demo@2026',
    'Church Schedule': 'Ratiba za Ibada', 'Visit the church website': 'Tembelea tovuti ya kanisa',
    // parish management system (parish/index.html is written in Kiswahili; these give the English view)
    'Parish System': 'Mfumo wa Parokia', 'Parish Profile': 'Taarifa za Parokia', 'Outstations and Communities': 'Vigango na Jumuiya',
    'Families and Parishioners': 'Familia na Waumini', 'Leaders': 'Viongozi', 'Harvest': 'Mavuno',
    'Special Contributions': 'Michango Maalumu', 'Pledges and Balances': 'Ahadi na Madeni', 'Envelopes': 'Bahasha',
    'Expenses': 'Matumizi', 'Accounting': 'Uhasibu', 'Receipts': 'Risiti', 'Financial Reconciliation': 'Uhakiki wa Fedha',
    'Users': 'Watumiaji', 'Main Portal': 'Lango Kuu', 'Record Payment': 'Rekodi Malipo', 'Confirm and Save': 'Thibitisha na Hifadhi',
    'New Pledge': 'Ahadi mpya', 'Filter': 'Chuja', 'From': 'Kuanzia', 'To': 'Hadi', 'Print': 'Chapa', 'Generate': 'Tengeneza',
    'Parishioners': 'Waumini', 'Families': 'Familia', 'Communities': 'Jumuiya', 'Outstations': 'Vigango',
    'Collections this month': 'Makusanyo ya mwezi huu', 'Funds available': 'Fedha zilizopo', 'Outstanding pledges': 'Ahadi ambazo hazijalipwa',
    'Recent transactions': 'Miamala ya karibuni', 'See all': 'Ona yote', 'Payer': 'Mlipaji', 'Amount': 'Kiasi', 'Status': 'Hali',
    'Pledged': 'Ahadi', 'Paid': 'Amelipa', 'Balance due': 'Deni', 'Excess': 'Ziada', 'Collected': 'Walichotoa',
    'Remaining': 'Kiasi bado', 'Reverse': 'Rudisha', 'Approve': 'Idhinisha', 'Reject': 'Kataa', 'Close': 'Funga', 'Save': 'Hifadhi',
  };

  /* dynamic strings rendered by page scripts */
  const PATTERNS = [
    [/^Showing (\d+) of (\d+) members$/, { sw: 'Inaonyesha $1 kati ya washirika $2' }],
    [/^Showing (\d+) of (\d+)$/, { sw: 'Inaonyesha $1 kati ya $2' }],
    [/^(\d[\d,]*) members match your filters$/, { sw: 'Washirika $1 wanalingana na vichujio' }],
    [/^Showing (.+) of (.+) members$/, { sw: 'Inaonyesha $1 kati ya washirika $2' }],
    [/^Page (\d+) of (\d+)$/, { sw: 'Ukurasa $1 kati ya $2' }],
  ];

  /* ── lookup tables ── */
  const SW2EN = {};
  Object.keys(EN2SW).forEach(en => { if (!(EN2SW[en] in SW2EN)) SW2EN[EN2SW[en]] = en; });
  const lowerKeys = map => Object.keys(map).reduce((o, k) => (o[k.toLowerCase()] = map[k], o), {});
  const EN2SW_L = lowerKeys(EN2SW);
  const SW2EN_L = lowerKeys(SW2EN);

  function readLang() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  let lang = readLang() === 'en' ? 'en' : 'sw';   // Kiswahili by default; English only when chosen

  function translateCore(text) {
    const map = lang === 'sw' ? EN2SW : SW2EN;
    const mapL = lang === 'sw' ? EN2SW_L : SW2EN_L;
    if (map[text] !== undefined) return map[text];
    const lower = text.toLowerCase();
    if (mapL[lower] !== undefined) {
      const t = mapL[lower];
      return text === text.toUpperCase() ? t.toUpperCase() : t;
    }
    // keep decorations such as "Full Name *", "Status:", "Search…"
    const m = text.match(/^(.*?)(\s*\*|:|…|\.\.\.)$/);
    if (m && m[1]) {
      const base = translateCore(m[1]);
      if (base !== m[1]) return base + m[2];
    }
    if (lang === 'sw') {
      for (const [re, out] of PATTERNS) if (re.test(text)) return text.replace(re, out.sw);
    }
    return text;
  }

  function translate(source) {
    if (lang === 'en' && !/[a-z]/i.test(source)) return source;
    const m = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2] || m[2].length > 160) return source;
    const out = translateCore(m[2]);
    return out === m[2] ? source : m[1] + out + m[3];
  }

  /* ── text nodes ── */
  const original = new WeakMap();   // node -> source text written by the page
  const written  = new WeakMap();   // node -> text we last wrote
  const SKIP = 'script,style,textarea,code,pre,[data-no-i18n],.material-symbols-outlined,.material-icons,[contenteditable="true"]';

  function handleText(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const current = node.nodeValue;
    if (written.get(node) !== current) original.set(node, current); // page changed it → new source
    const next = translate(original.get(node));
    if (next !== current) node.nodeValue = next;
    written.set(node, next);
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const originalAttr = new WeakMap();
  function handleAttrs(el) {
    if (el.closest(SKIP)) return;
    let store = originalAttr.get(el);
    ATTRS.forEach(a => {
      if (!el.hasAttribute(a)) return;
      if (!store) { store = {}; originalAttr.set(el, store); }
      const cur = el.getAttribute(a);
      if (store[a + ':w'] !== cur) store[a] = cur;
      const next = translate(store[a]);
      if (next !== cur) el.setAttribute(a, next);
      store[a + ':w'] = next;
    });
  }

  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) { handleText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches(SKIP)) return;
    handleAttrs(root);
    root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(handleAttrs);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) handleText(n);
  }

  let titleSource = document.title;
  let titleWritten = null;
  function translateTitle() {
    if (document.title !== titleWritten) titleSource = document.title;
    titleWritten = titleSource.split(/(\s[|—]\s)/).map(p => /^\s[|—]\s$/.test(p) ? p : translate(p)).join('');
    document.title = titleWritten;
  }

  function applyAll() {
    document.documentElement.lang = lang;
    walk(document.body);
    translateTitle();
    document.querySelectorAll('.kh-lang button').forEach(b => {
      b.classList.toggle('is-active', b.dataset.lang === lang);
      b.setAttribute('aria-pressed', b.dataset.lang === lang);
    });
  }

  /* ── follow content that page scripts add later ── */
  let queue = new Set(), scheduled = false;
  const observer = new MutationObserver(muts => {
    muts.forEach(m => {
      if (m.type === 'characterData') queue.add(m.target);
      else if (m.type === 'attributes') queue.add(m.target);
      else m.addedNodes.forEach(n => queue.add(n));
    });
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const items = queue; queue = new Set();
        items.forEach(n => { if (n.isConnected) walk(n); });
      });
    }
  });

  /* ── the SW | EN toggle ── */
  function makeToggle(extraClass) {
    const wrap = document.createElement('div');
    wrap.className = 'kh-lang ' + (extraClass || '');
    wrap.setAttribute('data-no-i18n', '');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Language');
    wrap.innerHTML = '<button type="button" data-lang="sw">SW</button><button type="button" data-lang="en">EN</button>';
    wrap.addEventListener('click', e => {
      const b = e.target.closest('button[data-lang]');
      if (!b || b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      try { localStorage.setItem(STORE_KEY, lang); } catch (err) {}
      applyAll();
    });
    return wrap;
  }

  function mountToggles() {
    let mounted = 0;
    const put = (target, how, cls) => {
      if (!target) return;
      const t = makeToggle(cls);
      if (how === 'prepend') target.insertBefore(t, target.firstChild);
      else if (how === 'before') target.parentNode.insertBefore(t, target);
      else target.appendChild(t);
      mounted++;
    };
    put(document.querySelector('.kh-topbar__right'), 'prepend');                       // admin / super-admin desktop
    const mh = document.querySelector('.mobile-header');                               // admin / super-admin phones
    if (mh && mh.lastElementChild) put(mh.lastElementChild, 'before', 'kh-lang--dark');
    put(document.querySelector('main > header.sticky > div:last-child'), 'prepend'); // member pages
    put(document.querySelector('body > header.sticky > div:last-child'), 'prepend'); // admin pages with own header
    put(document.getElementById('hamburger-btn'), 'before', 'kh-lang--nav');          // public homepage
    if (!mounted) put(document.body, 'append', 'kh-lang--float');                      // login, register, karibu…
  }

  const css = document.createElement('style');
  css.textContent = `
    .kh-lang{display:inline-flex;align-items:center;gap:2px;padding:3px;border-radius:999px;
      background:#f4f8f6;border:1px solid #e3eae7;font-family:'Nunito Sans',sans-serif;flex-shrink:0}
    .kh-lang button{min-width:34px;height:28px;padding:0 .55rem;border:0;border-radius:999px;cursor:pointer;
      background:transparent;color:#6b7c77;font-size:.7rem;font-weight:800;letter-spacing:.06em;transition:background .2s,color .2s}
    .kh-lang button.is-active{background:#3d5650;color:#e5c867;box-shadow:0 1px 3px rgba(0,0,0,.15)}
    .kh-lang--dark,.kh-lang--nav{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.15)}
    .kh-lang--dark button,.kh-lang--nav button{color:rgba(255,255,255,.75)}
    .kh-lang--dark button.is-active,.kh-lang--nav button.is-active{background:#d4a72c;color:#2a1f00}
    .kh-lang--nav{margin-left:.75rem}
    #main-nav.scrolled .kh-lang--nav{background:#f4f8f6;border-color:#e3eae7}
    #main-nav.scrolled .kh-lang--nav button{color:#6b7c77}
    #main-nav.scrolled .kh-lang--nav button.is-active{background:#3d5650;color:#e5c867}
    .kh-lang--float{position:fixed;top:14px;right:14px;z-index:200;box-shadow:0 6px 20px rgba(0,0,0,.18);background:#fff}
    .mobile-header .kh-lang{margin-left:auto;margin-right:.5rem}
  `;
  document.head.appendChild(css);

  function init() {
    mountToggles();
    applyAll();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ATTRS });
  }
  // after DOMContentLoaded handlers that build the top bar (admin-layout.js)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
