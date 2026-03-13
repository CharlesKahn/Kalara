const res = await fetch('http://localhost:3847/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    manualProjectId: 'proj_1772999323355_69da1918',
    question: 'What is our revenue model?',
  }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
