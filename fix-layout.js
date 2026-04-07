const fs = require('fs');

const content = fs.readFileSync('web/src/pages/Admin.tsx', 'utf8');

// Replace the misaligned grid
const newContent = content.replace(
	'<div className="grid gap-6 md:grid-cols-2">\n\t\t\t\t\t<TeamSnapImport />\n\t\t\t\t\t<Card>',
	'<div className="grid gap-6 md:grid-cols-2">\n\t\t\t\t\t<Card>'
).replace(
	'</p>\n\t\t\t\t</div>\n\n\t\t\t\t<div className="grid gap-6 md:grid-cols-2">',
	'</p>\n\t\t\t\t</div>\n\n\t\t\t\t<div className="grid gap-6 md:grid-cols-1">\n\t\t\t\t\t<TeamSnapImport />\n\t\t\t\t</div>\n\n\t\t\t\t<div className="grid gap-6 md:grid-cols-2">'
);

fs.writeFileSync('web/src/pages/Admin.tsx', newContent);
