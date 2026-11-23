import { createReportExamples } from '../../scripts/report-example-data';

test('four examples execute production decisions and the guarded publication failure path', async () => {
  const { examples, publicationStatusWrites } = await createReportExamples();
  expect(examples.map(example => example.slug)).toEqual(['normal', 'partial', 'failed', 'publication-failure']);
  expect(publicationStatusWrites).toEqual(['pending']);
  expect(examples[0].report).toContain('LOW risk · PASS · COMPLETE');
  expect(examples[0].report).toContain(`ref \`${'a'.repeat(40)}\``);
  expect(examples[1].report).toContain('Coverage: 1/2 supported files analyzed');
  expect(examples[1].report).toContain('line unavailable');
  expect(examples[2].report).toContain('this is not a clean result');
  expect(examples[3].report).toContain('Publication: FAILED');
  expect(examples[3].report).toContain('Last confirmed commit status: pending');
  expect(examples[3].report).toContain('Failed to create review report');
});

test('repeated generation is byte-identical and performs no model or GitHub requests', async () => {
  const first = await createReportExamples();
  const second = await createReportExamples();
  expect(second).toEqual(first);
  for (const example of first.examples) {
    expect(example.report).toContain('a'.repeat(40));
    expect(example.report).not.toContain('Report shortened');
  }
});
