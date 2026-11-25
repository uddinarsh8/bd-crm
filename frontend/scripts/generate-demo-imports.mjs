import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const output = join(process.cwd(), 'public', 'sample-imports');
await mkdir(output, { recursive: true });

const columns = [
  { header: 'Stakeholder ID', key: 'stakeholderId', width: 18 },
  { header: 'Account', key: 'account', width: 22 },
  { header: 'Full Name', key: 'fullName', width: 25 },
  { header: 'Designation', key: 'designation', width: 30 },
  { header: 'Vertical / Practice', key: 'vertical', width: 25 },
  { header: 'Reports To', key: 'reportsTo', width: 24 },
  { header: 'Org Level', key: 'orgLevel', width: 14 },
  { header: 'Location', key: 'location', width: 18 },
  { header: 'Email', key: 'email', width: 32 },
  { header: 'Phone', key: 'phone', width: 20 },
  { header: 'Relationship Status', key: 'relationshipStatus', width: 22 },
  { header: 'BD Owner', key: 'bdOwner', width: 20 },
  { header: 'Route via Vendor Management', key: 'routeViaVendor', width: 30 },
];

const locations = ['Bangalore', 'Chennai', 'Coimbatore', 'Delhi', 'Gurgaon', 'Hyderabad', 'Mumbai', 'Noida', 'Pune', 'US', 'Japan', 'Romania', 'Other'];
const statuses = ['Hot', 'Warm', 'Slightly Warm', 'Cold', 'Parked'];
const verticals = ['AIM', 'APPS', 'BFS', 'BPO', 'CDM', 'CDO', 'Cloud and Security', 'Cloud Transformation', 'Consulting', 'DAAI', 'DWS', 'Global Delivery', 'Healthcare', 'ID-AS', 'Infra Delivery Ops', 'Insurance', 'Oracle', 'PLM', 'Salesforce', 'SAP'];
const owners = ['Priya Nair', 'Rohan Mehta'];

async function createWorkbook(filename, rows = []) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BD CRM Demo';
  workbook.subject = 'Contact import example';
  const sheet = workbook.addWorksheet('Contacts', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns;
  sheet.addRows(rows);
  sheet.autoFilter = { from: 'A1', to: `M${Math.max(1, rows.length + 1)}` };
  const header = sheet.getRow(1);
  header.height = 28;
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1B3D' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FFFF3D8B' } } };
  });
  for (let row = 2; row <= Math.max(2, rows.length + 1); row += 1) {
    sheet.getCell(`G${row}`).dataValidation = { type: 'whole', operator: 'between', formulae: [-1, 4], allowBlank: true, showErrorMessage: true, errorTitle: 'Check org level', error: 'Enter a whole number from -1 to 4.' };
    sheet.getCell(`H${row}`).dataValidation = { type: 'list', formulae: [`"${locations.join(',')}"`], allowBlank: false, showErrorMessage: true };
    sheet.getCell(`K${row}`).dataValidation = { type: 'list', formulae: [`"${statuses.join(',')}"`], allowBlank: false, showErrorMessage: true };
    sheet.getCell(`L${row}`).dataValidation = { type: 'list', formulae: [`"${owners.join(',')}"`], allowBlank: false, showErrorMessage: true };
    sheet.getCell(`M${row}`).dataValidation = { type: 'list', formulae: ['"Yes,No"'], allowBlank: false, showErrorMessage: true };
    sheet.getRow(row).alignment = { vertical: 'middle' };
    if (row % 2 === 0) sheet.getRow(row).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F8FA' } }; });
  }
  sheet.getCell('A1').note = 'Leave blank for a new contact. Keep the ID unchanged to update an existing contact.';
  sheet.getCell('F1').note = 'Choose an existing contact in the same account.';
  sheet.getCell('G1').note = 'Optional. Use a whole number from -1 to 4.';
  sheet.getCell('I1').note = 'Optional when the contact has no known work email.';
  sheet.getCell('M1').note = 'Yes or No. A Yes value flags the contact for vendor-management routing.';
  await workbook.xlsx.writeFile(join(output, filename));
}

const newContacts = [
  { account: 'NTT DATA', fullName: 'Ishita Rao', designation: 'Director, Cloud Transformation', vertical: 'Cloud Transformation', reportsTo: 'Ananya Iyer', orgLevel: 2, location: 'Bangalore', email: 'ishita.rao@example.com', phone: '+91 98765 43210', relationshipStatus: 'Warm', bdOwner: 'Priya Nair', routeViaVendor: 'No' },
  { account: 'NTT DATA', fullName: 'Kabir Deshmukh', designation: 'Practice Lead, Data Platforms', vertical: 'DAAI', reportsTo: 'Rajesh Menon', orgLevel: 3, location: 'Pune', email: 'kabir.deshmukh@example.com', phone: '+91 98765 43211', relationshipStatus: 'Cold', bdOwner: 'Rohan Mehta', routeViaVendor: 'No' },
  { account: 'NTT DATA', fullName: 'Tara Nambiar', designation: 'Senior Manager, Partner Relations', vertical: 'BFS', reportsTo: 'Ananya Iyer', orgLevel: 3, location: 'Chennai', email: 'tara.nambiar@example.com', phone: '+91 98765 43212', relationshipStatus: 'Slightly Warm', bdOwner: 'Priya Nair', routeViaVendor: 'Yes' },
];

const updates = [
  { stakeholderId: 'SH-0002', account: 'NTT DATA', fullName: 'Rajesh Menon', designation: 'Director - Data & AI', vertical: 'DAAI', reportsTo: 'Ananya Iyer', orgLevel: 2, location: 'Bangalore', email: 'rajesh.menon@example.com', phone: '+91 98765 43210', relationshipStatus: 'Hot', bdOwner: 'Priya Nair', routeViaVendor: 'No' },
  { stakeholderId: 'SH-0003', account: 'NTT DATA', fullName: 'Sneha Kulkarni', designation: 'Senior Manager - Quality Engineering', vertical: 'APPS', reportsTo: 'Rajesh Menon', orgLevel: 3, location: 'Chennai', email: 'sneha.kulkarni@example.com', phone: '+91 98765 43213', relationshipStatus: 'Warm', bdOwner: 'Rohan Mehta', routeViaVendor: 'No' },
];

await createWorkbook('BD-CRM-Contact-Import-Template.xlsx');
await createWorkbook('BD-CRM-Sample-New-Contacts.xlsx', newContacts);
await createWorkbook('BD-CRM-Sample-Contact-Updates.xlsx', updates);
console.log(`Created three sample workbooks in ${output}`);
