/**
 * Generates `seed/seed.sql` from the CV.
 *
 * Deliberately *generated* rather than hand-written, because it reuses the
 * production code paths:
 *
 *   • Publications come from `seed/publications.bib`, parsed by the same
 *     BibTeX parser the admin panel uses — so the seed exercises the real
 *     import (LaTeX decoding, author dedupe, IEEE citations, categorisation).
 *   • Blog and biography markdown is rendered by the same unified/remark
 *     pipeline the save path uses, so the seeded HTML is byte-identical to what
 *     the CMS would produce.
 *   • The admin password is hashed with the same PBKDF2 function the login
 *     endpoint verifies against.
 *
 * Hand-writing 45 publications as INSERT statements would have been faster to
 * type and impossible to keep correct.
 *
 *   npm run seed:build
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseBibtexToDrafts, type PublicationDraft } from '../src/lib/bibtex/index';
import { renderMarkdown, renderRichText } from '../src/lib/content/markdown';
import { hashPassword } from '../src/lib/auth/password';
import { normalizeKey, slugify } from '../src/lib/utils/text';

/* ═══════════════════════════════════════════════════════════════════════════
 * SQL helpers
 * ═══════════════════════════════════════════════════════════════════════════ */

type Value = string | number | boolean | null | undefined | Date | object;

/** Escapes a value into a SQL literal. */
function sql(value: Value): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return String(Math.floor(value.getTime() / 1000));
  if (typeof value === 'object') return sql(JSON.stringify(value));
  return `'${value.replace(/'/g, "''")}'`;
}

const statements: string[] = [];

function insert(table: string, rows: Array<Record<string, Value>>): void {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]!);

  statements.push(
    `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES\n` +
      rows
        .map((row) => `  (${columns.map((column) => sql(row[column])).join(', ')})`)
        .join(',\n') +
      ';',
  );
}

function section(title: string): void {
  statements.push(
    `\n-- ${'─'.repeat(72)}\n-- ${title}\n-- ${'─'.repeat(72)}`,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Content — transcribed from the YÖK CV
 * ═══════════════════════════════════════════════════════════════════════════ */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'oeyeci@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe!2026-Admin';

const PROFESSIONAL_BIO = `
I am an Associate Professor in the **Department of Computer Engineering** at
Bolu Abant İzzet Baysal University, where my work sits at the meeting point of
machine learning, quantum computing and energy systems.

My research asks a fairly concrete question: *where does quantum computing
actually help?* Much of the field is still promissory, so my group builds
hybrid classical–quantum models for problems that have a real cost function —
forecasting smart-grid stability, identifying loads on a distribution network,
predicting wind and solar output — and measures them honestly against strong
classical baselines. Some of the time the quantum model wins on data efficiency;
when it does not, that is a result too.

Before computer engineering I spent a decade as a computational physicist.
My doctorate used order-*N* tight-binding molecular dynamics to simulate how
carbon nanotubes deform and how their electronic band gaps shift under strain —
work that meant writing and parallelising the simulation codes themselves. That
background still shapes how I approach engineering problems: start from the
physics, then decide what the model is allowed to assume.

I have also written scientific software used by other groups —
[**ZXCOM**](https://doi.org/10.1080/10420150.2016.1263958) and
[**BXCOM**](https://doi.org/10.1080/10420150.2019.1606811), for computing
effective atomic numbers and radiation buildup factors — and I hold three
patents in assistive and safety technology.
`.trim();

const ACADEMIC_BIO = `
I received my BSc (2000), MSc (2005) and PhD (2012) in Physics from **Yıldız
Technical University**, all under the supervision of Prof. Dr. Gülay Dereli.
My doctoral thesis, *Computer simulations of the electronic structure of carbon
nanotubes*, developed parallel order-*N* tight-binding molecular dynamics
simulations of single-walled carbon nanotubes under uniaxial strain.

I served as a Research Assistant at Yıldız Technical University from 2002 to
2012, then held Assistant Professor posts at **İstanbul Gelişim University**
(Mechatronics Engineering, 2013–2016) and **Nişantaşı University** (Computer
Engineering, 2016–2021), where I was Head of Department and, for periods,
Director of the Institute of Science.

I joined **Bolu Abant İzzet Baysal University** in 2021 and was promoted to
Associate Professor in March 2023. From 2021 to 2024 I served as **Vice Dean of
the Faculty of Engineering**.

I have supervised one doctoral and three master's theses to completion, led a
TÜBİTAK 3001 project as Principal Investigator, and serve as an associate editor
for the *International Journal of Renewable Energy Research*, the *International
Journal of Smart Grid* and the *International Journal of Engineering Science and
Application*.
`.trim();

const RESEARCH_INTERESTS = [
  {
    title: 'Quantum Machine Learning',
    description:
      'Hybrid classical–quantum neural networks, variational circuits and quantum kernels — evaluated against strong classical baselines rather than in isolation.',
    isFeatured: true,
  },
  {
    title: 'Smart Grids & Energy Forecasting',
    description:
      'Stability prediction, non-intrusive load identification, and forecasting for wind, solar and electricity demand.',
    isFeatured: true,
  },
  {
    title: 'Artificial Intelligence',
    description:
      'Neural networks, ANFIS and regression models applied to problems where the ground truth comes from physics, not from labels.',
    isFeatured: true,
  },
  {
    title: 'Computational Materials Science',
    description:
      'Order-N tight-binding molecular dynamics of carbon nanotubes: strain, vacancy defects, and band-gap engineering.',
    isFeatured: true,
  },
  {
    title: 'Scientific Software',
    description:
      'ZXCOM and BXCOM — open tools for computing effective atomic numbers and radiation buildup factors.',
    isFeatured: false,
  },
  {
    title: 'Computer Vision',
    description:
      'GPU-accelerated image processing, deep learning for defect and obstruction detection on solar installations.',
    isFeatured: false,
  },
];

const EDUCATION = [
  {
    degree: 'Ph.D.',
    field: 'Physics',
    institution: 'Yıldız Technical University',
    department: 'Institute of Science',
    location: 'İstanbul, Turkey',
    startYear: 2005,
    endYear: 2012,
    completedOn: '22 August 2012',
    thesisTitle: 'Computer simulations of the electronic structure of carbon nanotubes',
    advisor: 'Prof. Dr. Gülay Dereli',
  },
  {
    degree: 'M.Sc.',
    field: 'Physics (English, with thesis)',
    institution: 'Yıldız Technical University',
    department: 'Institute of Science',
    location: 'İstanbul, Turkey',
    startYear: 2002,
    endYear: 2005,
    completedOn: '10 August 2005',
    thesisTitle:
      'Investigation of the physical properties of carbon nanotubes by computer simulation methods',
    advisor: 'Prof. Dr. Gülay Dereli',
  },
  {
    degree: 'B.Sc.',
    field: 'Physics',
    institution: 'Yıldız Technical University',
    department: 'Faculty of Arts and Sciences',
    location: 'İstanbul, Turkey',
    startYear: 1996,
    endYear: 2000,
    completedOn: '9 August 2000',
    thesisTitle: null,
    advisor: null,
  },
];

const EXPERIENCES = [
  {
    type: 'academic',
    title: 'Associate Professor',
    organization: 'Bolu Abant İzzet Baysal University',
    department: 'Department of Computer Engineering — Computer Science Division',
    location: 'Bolu, Turkey',
    startDate: '2023-03-13',
    endDate: null,
    isCurrent: true,
    descriptionMd:
      'Leading research in quantum machine learning and intelligent energy systems. Teaching **Operating Systems** and **Software Requirements Analysis** at undergraduate level.',
  },
  {
    type: 'administrative',
    title: 'Vice Dean',
    organization: 'Bolu Abant İzzet Baysal University',
    department: 'Faculty of Engineering',
    location: 'Bolu, Turkey',
    startDate: '2021-10-06',
    endDate: '2024-11-07',
    isCurrent: false,
    descriptionMd:
      'Academic administration across the faculty: curriculum, accreditation, and staff development.',
  },
  {
    type: 'academic',
    title: 'Assistant Professor',
    organization: 'Bolu Abant İzzet Baysal University',
    department: 'Department of Computer Engineering',
    location: 'Bolu, Turkey',
    startDate: '2021-06-29',
    endDate: '2023-03-13',
    isCurrent: false,
    descriptionMd: null,
  },
  {
    type: 'academic',
    title: 'Assistant Professor',
    organization: 'Nişantaşı University',
    department: 'Department of Computer Engineering',
    location: 'İstanbul, Turkey',
    startDate: '2016-01-01',
    endDate: '2021-06-01',
    isCurrent: false,
    descriptionMd:
      'Built and led the Computer Engineering department. Supervised graduate research in machine learning for renewable energy.',
  },
  {
    type: 'administrative',
    title: 'Head of Department',
    organization: 'Nişantaşı University',
    department: 'Department of Computer Engineering',
    location: 'İstanbul, Turkey',
    startDate: '2016-10-20',
    endDate: '2021-06-01',
    isCurrent: false,
    descriptionMd: null,
  },
  {
    type: 'administrative',
    title: 'Director of the Institute of Science',
    organization: 'Nişantaşı University',
    department: 'Institute of Science',
    location: 'İstanbul, Turkey',
    startDate: '2019-05-08',
    endDate: '2019-08-01',
    isCurrent: false,
    descriptionMd: null,
  },
  {
    type: 'administrative',
    title: 'Vice Director of the Institute of Science',
    organization: 'Nişantaşı University',
    department: 'Institute of Science',
    location: 'İstanbul, Turkey',
    startDate: '2016-12-29',
    endDate: '2019-06-01',
    isCurrent: false,
    descriptionMd: null,
  },
  {
    type: 'academic',
    title: 'Assistant Professor',
    organization: 'İstanbul Gelişim University',
    department: 'Department of Mechatronics Engineering',
    location: 'İstanbul, Turkey',
    startDate: '2013-01-01',
    endDate: '2016-01-01',
    isCurrent: false,
    descriptionMd: null,
  },
  {
    type: 'administrative',
    title: 'Director of the Institute of Science',
    organization: 'İstanbul Gelişim University',
    department: 'Institute of Science',
    location: 'İstanbul, Turkey',
    startDate: '2014-01-01',
    endDate: '2015-01-01',
    isCurrent: false,
    descriptionMd: null,
  },
  {
    type: 'academic',
    title: 'Lecturer',
    organization: 'Haliç University',
    department: 'Vocational School',
    location: 'İstanbul, Turkey',
    startDate: '2012-01-01',
    endDate: '2013-01-01',
    isCurrent: false,
    descriptionMd: null,
  },
  {
    type: 'academic',
    title: 'Research Assistant',
    organization: 'Yıldız Technical University',
    department: 'Department of Physics',
    location: 'İstanbul, Turkey',
    startDate: '2002-01-01',
    endDate: '2012-01-01',
    isCurrent: false,
    descriptionMd:
      'Ten years in the computational physics group of Prof. Dr. Gülay Dereli, writing and parallelising tight-binding molecular dynamics codes for carbon nanotube simulation.',
  },
  {
    type: 'industry',
    title: 'Founder',
    organization: 'Zecom Bilişim Teknoloji Geliştirme',
    department: null,
    location: 'İstanbul, Turkey',
    startDate: '2016-01-01',
    endDate: '2018-01-01',
    isCurrent: false,
    descriptionMd: 'Independent software and technology development consultancy.',
  },
  {
    type: 'industry',
    title: 'Linux Systems Administrator',
    organization: 'Universal Group',
    department: 'IT Centre',
    location: 'İstanbul, Turkey',
    startDate: '2012-01-01',
    endDate: '2013-01-01',
    isCurrent: false,
    descriptionMd: null,
  },
  {
    type: 'editorial',
    title: 'Associate Editor',
    organization: 'International Journal of Renewable Energy Research (IJRER)',
    department: null,
    location: null,
    startDate: '2016-01-01',
    endDate: null,
    isCurrent: true,
    descriptionMd:
      'Associate editor for IJRER, the International Journal of Smart Grid, and the International Journal of Engineering Science and Application.',
  },
];

const PROJECTS = [
  {
    title:
      'Development of a software package capable of computing radiation buildup factors (BXCOM)',
    funder: 'TÜBİTAK',
    grantNumber: '3001',
    role: 'pi',
    team: 'Önder Eyecioğlu (PI), Orhan İçelli',
    startDate: '2015-11-01',
    endDate: '2017-12-31',
    status: 'completed',
    scope: 'national',
    descriptionMd:
      'Principal Investigator on a TÜBİTAK 3001 grant to build **BXCOM**, an open tool for computing exposure and energy-absorption buildup factors for arbitrary materials. Published in *Radiation Effects and Defects in Solids*.',
  },
  {
    title:
      'Determination of ionizing-radiation shielding performance and capacitive properties of epoxy/Ag micro- and nano-composites, and their optimization with machine learning',
    funder: 'Scientific Research Projects (BAP)',
    grantNumber: null,
    role: 'researcher',
    team: 'Mehmet Kılıç (PI), Önder Eyecioğlu, Nureddin Ertuğrul Kalkan',
    startDate: '2022-06-16',
    endDate: null,
    status: 'ongoing',
    scope: 'national',
    descriptionMd: null,
  },
  {
    title: 'Investigation of the behaviour of materials in mechanical and electromagnetic systems',
    funder: 'Scientific Research Projects (BAP)',
    grantNumber: null,
    role: 'researcher',
    team: 'Murat Beken (PI), Önder Eyecioğlu, Batuhan Hangın',
    startDate: '2019-08-07',
    endDate: '2022-03-14',
    status: 'completed',
    scope: 'national',
    descriptionMd: null,
  },
  {
    title: 'Decision-making with image processing techniques in virtual classroom applications',
    funder: 'Scientific Research Projects (BAP)',
    grantNumber: null,
    role: 'advisor',
    team: 'Tuncay Sevindik (PI), Muhammet Toraman, Ömer Bilen — advisor: Önder Eyecioğlu',
    startDate: '2016-02-15',
    endDate: '2019-12-25',
    status: 'completed',
    scope: 'national',
    descriptionMd: null,
  },
  {
    title:
      'Computer simulation of carbon nanotubes and nano metals and alloys',
    funder: 'Scientific Research Projects (BAP)',
    grantNumber: null,
    role: 'researcher',
    team: 'Gülay Dereli (PI), Önder Eyecioğlu, Banu Süngü Mısırlıoğlu',
    startDate: '2003-01-01',
    endDate: '2004-07-01',
    status: 'completed',
    scope: 'national',
    descriptionMd: null,
  },
  {
    title:
      'Computer simulation of the mechanical and electronic properties of single-walled carbon nanotubes under strain',
    funder: 'Scientific Research Projects (BAP)',
    grantNumber: null,
    role: 'researcher',
    team: null,
    startDate: '2010-01-01',
    endDate: '2012-01-01',
    status: 'completed',
    scope: 'national',
    descriptionMd: null,
  },
];

const THESES = [
  {
    studentName: 'Yaşar Karabul',
    title:
      'Next-generation radiation shields: epoxy-based metal-oxide micro- and nano-structured composites',
    degree: 'phd',
    year: 2021,
    institution: 'Yıldız Technical University — Institute of Science, Physics',
    status: 'completed',
  },
  {
    studentName: 'Nureddin Ertuğrul Kalkan',
    title:
      'Determination of the ionizing-radiation shielding performance of epoxy-based micro- and nano-sized silver-doped composites',
    degree: 'msc',
    year: 2025,
    institution: 'Yıldız Technical University — Institute of Science, Physics',
    status: 'completed',
  },
  {
    studentName: 'Serlin İş',
    title:
      'Yttrium- and europium-based copper-oxide layered ceramics: production, impedance characterisation, and prediction with artificial intelligence',
    degree: 'msc',
    year: 2023,
    institution: 'Yıldız Technical University — Institute of Science, Physics',
    status: 'completed',
  },
  {
    studentName: 'Ahmet Nihat Bilgen',
    title:
      'Development of a software package for computing effective atomic numbers as a function of scattering angle: ZXCOM',
    degree: 'msc',
    year: 2015,
    institution: 'Yıldız Technical University — Institute of Science, Physics',
    status: 'completed',
  },
];

const SKILL_GROUPS = [
  {
    name: 'Programming Languages',
    displayMode: 'bar',
    description: 'Languages I use for research code, teaching and production systems.',
    skills: [
      { name: 'Python', level: 95, levelLabel: 'Expert' },
      { name: 'C / C++', level: 88, levelLabel: 'Advanced' },
      { name: 'MATLAB', level: 90, levelLabel: 'Expert' },
      { name: 'Fortran', level: 80, levelLabel: 'Advanced' },
      { name: 'JavaScript / TypeScript', level: 78, levelLabel: 'Advanced' },
      { name: 'SQL', level: 82, levelLabel: 'Advanced' },
      { name: 'Bash', level: 85, levelLabel: 'Advanced' },
    ],
  },
  {
    name: 'Frameworks & Libraries',
    displayMode: 'bar',
    description: 'The tools my group builds models with.',
    skills: [
      { name: 'PyTorch', level: 90, levelLabel: 'Expert' },
      { name: 'TensorFlow / Keras', level: 88, levelLabel: 'Advanced' },
      { name: 'Qiskit', level: 85, levelLabel: 'Advanced' },
      { name: 'PennyLane', level: 82, levelLabel: 'Advanced' },
      { name: 'scikit-learn', level: 92, levelLabel: 'Expert' },
      { name: 'OpenCV', level: 86, levelLabel: 'Advanced' },
      { name: 'NumPy / SciPy / pandas', level: 94, levelLabel: 'Expert' },
    ],
  },
  {
    name: 'Cloud & Infrastructure',
    displayMode: 'chip',
    description: null,
    skills: [
      { name: 'Cloudflare Workers', level: 80, levelLabel: 'Advanced' },
      { name: 'Docker', level: 84, levelLabel: 'Advanced' },
      { name: 'Linux (RHEL, Debian)', level: 92, levelLabel: 'Expert' },
      { name: 'HPC / SLURM', level: 88, levelLabel: 'Advanced' },
      { name: 'MPI & OpenMP', level: 86, levelLabel: 'Advanced' },
      { name: 'CUDA', level: 75, levelLabel: 'Proficient' },
      { name: 'Git', level: 90, levelLabel: 'Expert' },
      { name: 'PostgreSQL', level: 76, levelLabel: 'Proficient' },
    ],
  },
  {
    name: 'Research Areas',
    displayMode: 'card',
    description: 'The problems, rather than the tools.',
    skills: [
      {
        name: 'Quantum Machine Learning',
        level: 0,
        description:
          'Variational quantum circuits, quantum kernels and classical–quantum transfer learning for forecasting and classification.',
      },
      {
        name: 'Smart Grid Analytics',
        level: 0,
        description:
          'Stability forecasting, non-intrusive load identification, and EV charging-behaviour analysis.',
      },
      {
        name: 'Renewable Energy Forecasting',
        level: 0,
        description: 'Wind and solar power prediction; snow and obstruction detection on PV arrays.',
      },
      {
        name: 'Molecular Dynamics',
        level: 0,
        description:
          'Order-N tight-binding MD of carbon nanotubes: strain response, vacancy defects and band-gap modulation.',
      },
      {
        name: 'Radiation Physics',
        level: 0,
        description:
          'Effective atomic numbers, buildup factors, and shielding-material design (ZXCOM, BXCOM).',
      },
      {
        name: 'Dielectric Materials',
        level: 0,
        description:
          'ML-based prediction of the dielectric and AC-conductivity behaviour of polymer composites.',
      },
    ],
  },
  {
    name: 'Teaching',
    displayMode: 'chip',
    description: 'Courses taught at undergraduate and graduate level.',
    skills: [
      { name: 'Operating Systems', level: 0, levelLabel: null },
      { name: 'Software Requirements Analysis', level: 0, levelLabel: null },
      { name: 'Machine Learning', level: 0, levelLabel: null },
      { name: 'Computational Physics', level: 0, levelLabel: null },
      { name: 'Parallel Programming', level: 0, levelLabel: null },
      { name: 'Image Processing', level: 0, levelLabel: null },
    ],
  },
  {
    name: 'Languages',
    displayMode: 'bar',
    description: null,
    skills: [
      { name: 'Turkish', level: 100, levelLabel: 'Native' },
      { name: 'English', level: 85, levelLabel: 'Professional (C1)' },
    ],
  },
  {
    name: 'Certificates & Training',
    displayMode: 'certificate',
    description: null,
    skills: [
      {
        name: 'Summer School on Modeling Nanostructures using Density Functional Theory (NANODFT09)',
        level: 0,
        issuedBy: 'İzmir Institute of Technology (İYTE)',
        issuedYear: 2009,
      },
      {
        name: '4th Summer School on High-Performance Computing and Parallel Programming',
        level: 0,
        issuedBy: 'İstanbul Technical University',
        issuedYear: 2009,
      },
      {
        name: 'ZXCOM — Registered Software Copyright',
        level: 0,
        issuedBy: 'Republic of Türkiye, Directorate General of Copyright',
        issuedYear: 2015,
        credentialId: 'İEE/BP-VT/2217',
      },
    ],
  },
];

const AWARDS = [
  {
    title: 'TÜBİTAK 3001 Research Grant — Principal Investigator',
    issuer: 'The Scientific and Technological Research Council of Türkiye',
    year: 2015,
    description:
      'Awarded for the development of BXCOM, a software package for computing radiation buildup factors.',
  },
  {
    title: 'Registered Software Copyright — ZXCOM',
    issuer: 'Directorate General of Copyright, Ministry of Culture and Tourism',
    year: 2015,
    description: 'Registration İEE/BP-VT/2217 for the ZXCOM effective-atomic-number software.',
  },
  {
    title: 'Three granted patents in assistive and safety technology',
    issuer: 'Turkish Patent and Trademark Office',
    year: 2020,
    description:
      'Eye-blink-controlled wheelchair (2017), automatic accident detection and warning device (2017), and an integrative analysis system (2020/17759).',
  },
];

const MEMBERSHIPS = [
  {
    organization: 'International Journal of Renewable Energy Research (IJRER)',
    role: 'Associate Editor',
    startYear: 2016,
    endYear: null,
  },
  {
    organization: 'International Journal of Smart Grid (ijSmartGrid)',
    role: 'Associate Editor',
    startYear: 2018,
    endYear: null,
  },
  {
    organization: 'International Journal of Engineering Science and Application (IJESA)',
    role: 'Associate Editor',
    startYear: 2017,
    endYear: null,
  },
  {
    organization: 'Abant Journal of Health Sciences and Technologies',
    role: 'Editor',
    startYear: 2023,
    endYear: null,
  },
];

/* ── Sample blog posts (markdown → rendered by the real pipeline) ─────────── */

const BLOG_POSTS = [
  {
    title: 'Does quantum machine learning actually help on the smart grid?',
    slug: 'does-quantum-machine-learning-help-smart-grid',
    categorySlug: 'quantum-computing',
    tags: ['quantum machine learning', 'smart grid', 'benchmarking'],
    isFeatured: true,
    daysAgo: 12,
    excerpt:
      'Quantum models are usually benchmarked against weak baselines. Here is what happens when you benchmark them honestly — and where they still win.',
    markdown: `
Most papers claiming a "quantum advantage" in machine learning are comparing a
carefully tuned quantum model against a classical baseline that nobody tuned at
all. That is not a fair fight, and it is not a useful result.

So when we built [QLID-Net](https://doi.org/10.1109/ACCESS.2026.3668295), a
hybrid quantum–classical network for smart-grid load identification, we made
ourselves a rule: **the classical baseline gets the same hyperparameter budget
as the quantum model.** Same search, same compute, same patience.

## What we were actually predicting

Non-intrusive load monitoring (NILM) asks: given only the aggregate power signal
at a building's meter, which appliances are running? It is a multi-label
classification problem over a signal that is noisy, non-stationary, and — this
is the important part — **expensive to label**.

That last property is why it is a reasonable place to look for a quantum
advantage. The theoretical arguments for QML rarely promise faster training.
What some of them promise is better *generalisation from few samples*.

## The architecture

The model is a variational circuit sandwiched between two classical layers:

\`\`\`python
import pennylane as qml
from pennylane import numpy as np

n_qubits = 8
dev = qml.device("default.qubit", wires=n_qubits)

@qml.qnode(dev, interface="torch", diff_method="backprop")
def circuit(inputs, weights):
    # Angle embedding: each feature becomes a rotation angle.
    qml.AngleEmbedding(inputs, wires=range(n_qubits), rotation="Y")

    # Strongly-entangling ansatz — the part that is actually learned.
    qml.StronglyEntanglingLayers(weights, wires=range(n_qubits))

    return [qml.expval(qml.PauliZ(w)) for w in range(n_qubits)]
\`\`\`

The classical encoder compresses 128 spectral features down to the 8 the circuit
can accept; the decoder maps the 8 expectation values back out to appliance
labels.

## The result that mattered

With the **full** training set, the classical baseline matched the hybrid model.
No advantage. If we had stopped there — as a lot of papers effectively do, in the
other direction — the story would have been "quantum wins," and it would have
been wrong.

The interesting behaviour only appears when you starve both models of data:

| Training samples | Classical $F_1$ | Hybrid $F_1$ | Δ |
| ---------------- | --------------- | ------------ | ------ |
| 5,000            | 0.913           | 0.916        | +0.003 |
| 1,000            | 0.871           | 0.894        | +0.023 |
| 500              | 0.804           | 0.858        | +0.054 |
| 100              | 0.612           | 0.731        | +0.119 |

The gap widens as the data shrinks. At 100 labelled samples the hybrid model is
nearly 12 $F_1$ points ahead.

## Why this might be happening

The usual explanation is expressivity: the feature map

$$
\\phi(x) = U(x)\\,|0\\rangle^{\\otimes n}
$$

lifts the input into a $2^n$-dimensional Hilbert space, and the induced kernel

$$
k(x, x') = \\left| \\langle 0 |\\, U^{\\dagger}(x)\\, U(x')\\, |0 \\rangle \\right|^{2}
$$

can separate points that a classical kernel of comparable parameter count cannot.

I want to be careful here. That is a *plausible* mechanism, not a demonstrated
one. We measured an effect; we did not prove its cause. The honest summary is:

> On this problem, under a matched hyperparameter budget, the hybrid model
> generalises better from small labelled datasets. We do not yet know how far
> that finding travels.

## What we are doing next

- Testing whether the advantage survives on **real** meter data rather than
  simulated aggregates.
- Running on actual quantum hardware, where noise may eat the entire margin.
- Checking whether a classical model with a comparable *inductive bias* — not
  just comparable parameter count — closes the gap.

If the third experiment closes the gap, then what we found is a statement about
inductive bias, not about quantum mechanics. That would still be worth knowing.
`.trim(),
  },
  {
    title: 'Ten years of carbon nanotube simulations, in one plot',
    slug: 'ten-years-carbon-nanotube-simulations',
    categorySlug: 'computational-physics',
    tags: ['molecular dynamics', 'carbon nanotubes', 'tight binding'],
    isFeatured: true,
    daysAgo: 38,
    excerpt:
      'My doctorate was spent stretching simulated nanotubes until they broke. Here is what a decade of that work distilled down to.',
    markdown: `
Between 2002 and 2012 I ran, by a rough count, several thousand tight-binding
molecular dynamics simulations of single-walled carbon nanotubes. Almost all of
them did the same thing: take a tube, pull on it, and watch what happens to its
electronic structure.

## The method, briefly

Tight-binding molecular dynamics sits in an awkward but useful place. *Ab initio*
DFT is more accurate and hopelessly expensive at the system sizes we needed;
classical potentials are cheap but cannot tell you anything about a band gap. TBMD
keeps a quantum-mechanical description of the electrons while remaining tractable
for a few thousand atoms.

The catch is that diagonalising the Hamiltonian is $O(N^3)$, which is fatal.
Order-$N$ methods get around this by exploiting the **locality of the density
matrix** — the observation that, in a system with a band gap, the density matrix
elements decay exponentially with distance:

$$
\\rho_{ij} \\sim e^{-\\gamma |r_i - r_j|}
$$

Truncate below a cutoff and the cost collapses to linear. That is what made a
decade of this work possible on the hardware we had.

## The finding that held up

Across chiralities, temperatures and defect densities, one relationship kept
reappearing: **band gap responds almost linearly to axial strain, and the sign of
the slope depends on chirality mod 3.**

For a zigzag $(n, 0)$ tube:

- $n \\bmod 3 = 1$ → the gap *opens* under tension
- $n \\bmod 3 = 2$ → the gap *closes* under tension
- $n \\bmod 3 = 0$ → metallic, and a small gap opens either way

This is not our discovery — it falls out of zone-folding arguments — but seeing
it emerge from an atomistic simulation that knows nothing about zone folding is
the kind of thing that makes you trust your code.

## Where the defects came in

Perfect nanotubes are a physicist's fiction. Real ones have vacancies. So we
started removing atoms, and the picture got more interesting: a single vacancy
introduces localised states in the gap, and at sufficient vacancy density the
strain response stops being linear altogether.

The practical consequence is uncomfortable for anyone hoping to build a
strain sensor out of these things: **your calibration curve depends on your
defect density**, which you generally do not know.

## What I took with me

I do not simulate nanotubes any more. But two habits from that decade have
followed me into machine learning:

1. **Know what your model is allowed to assume.** Order-$N$ methods work because
   of a physical property (density-matrix locality). Use them where that property
   does not hold and they will quietly give you garbage. Neural networks have
   exactly the same failure mode, minus the honesty of a physical justification.

2. **Cheap and wrong beats expensive and wrong.** The whole reason to do TBMD is
   that you have decided which errors you can live with. Most modelling is that
   decision, made well or badly.
`.trim(),
  },
  {
    title: 'What I look for when supervising a first research project',
    slug: 'supervising-a-first-research-project',
    categorySlug: 'academic-life',
    tags: ['supervision', 'research', 'graduate school'],
    isFeatured: false,
    daysAgo: 71,
    excerpt:
      'After supervising one doctoral and three master\'s theses, the thing I select for is not the thing I expected.',
    markdown: `
I have supervised one PhD and three master's theses to completion, plus a long
tail of undergraduate projects. When a student asks to work with me, I am not
really evaluating what they think I am evaluating.

## What I am not looking for

**Grades.** They tell me a student can do assigned work with a known answer.
Research has neither of those properties.

**Prior knowledge of my field.** The literature can be read in a semester.
Whatever a first-year student knows about quantum machine learning today will be
partly obsolete by the time they submit.

**Confidence.** I have watched confident students stall for a year because they
could not say "I don't understand this."

## What I am actually looking for

### Tolerance for a null result

Most experiments do not work. A student who can run an experiment, get nothing,
and report it accurately — without inflating it, and without being crushed by it —
will finish. A student who needs every experiment to succeed will start
unconsciously steering their analysis, and I will spend the next two years
checking their work rather than reading it.

The best answer I have ever heard to "how did the experiment go?" was:

> "It didn't work, and I think I know why, and I think the reason is more
> interesting than the thing I was trying to show."

### The ability to say "I don't know"

Precisely and without embarrassment. There is an enormous difference between
"I don't understand the paper" and "I don't understand why they use a
Trotter decomposition in equation 7." The second is a research question. The
first is a mood.

### Something they finished

Anything. A game, a mod, a small library, a bicycle rebuilt from parts. I do not
care what it is. Finishing is a skill, it is rarer than talent, and it does not
appear on a transcript.

## The one thing I promise in return

That I will tell them when their work is not good enough, early, while there is
still time to fix it — and that I will be specific about why.

A supervisor who is kind at month six and brutal at month twenty-three has not
been kind. They have been comfortable.
`.trim(),
  },
];

const BLOG_CATEGORIES = [
  {
    name: 'Quantum Computing',
    slug: 'quantum-computing',
    color: '#5b6bf0',
    description:
      'Hybrid quantum–classical models, variational circuits, and where quantum methods actually earn their keep.',
  },
  {
    name: 'Computational Physics',
    slug: 'computational-physics',
    color: '#0ea5a4',
    description: 'Molecular dynamics, simulation methods, and lessons from a decade of them.',
  },
  {
    name: 'Academic Life',
    slug: 'academic-life',
    color: '#c2701a',
    description: 'Supervision, peer review, teaching, and the parts of the job nobody trains you for.',
  },
];

const ACTIVITY_CATEGORIES = [
  { name: 'Conference', slug: 'conference', color: '#5b6bf0' },
  { name: 'Invited Talk', slug: 'invited-talk', color: '#0ea5a4' },
  { name: 'Workshop', slug: 'workshop', color: '#c2701a' },
];

const ACTIVITIES = [
  {
    title: 'IEEE ISVLSI 2025 — Quantum neural architectures for wind power',
    slug: 'isvlsi-2025-quantum-wind-power',
    activityDate: '2025-07-08',
    location: 'Bologna, Italy',
    categorySlug: 'conference',
    excerpt:
      'Presented two papers at the IEEE Computer Society Annual Symposium on VLSI: a comparative study of QNN architectures for wind power prediction, and quantum-enhanced brain-tumour classification from DNA microarray data.',
    descriptionMd: `
We presented two papers at **ISVLSI 2025** in Bologna.

The first compared quantum neural network architectures for wind power
prediction, systematically varying the **feature map** and the **ansatz** —
which, in most QML papers, are chosen once and never revisited. The result was
that ansatz depth matters far less than people assume, and feature-map choice
matters far more.

The second, with Emine Akpınar and colleagues, applied quantum-enhanced
classification to brain-tumour identification from DNA microarray gene
expression profiles — a genuinely high-dimensional, low-sample problem, which is
where we keep finding hybrid models pull ahead.

The most useful conversations, as usual, happened in the coffee queue.
`.trim(),
  },
  {
    title: 'icSmartGrid 2025 — Clustering for grid stability prediction',
    slug: 'icsmartgrid-2025-clustering',
    activityDate: '2025-05-20',
    location: 'Paris, France',
    categorySlug: 'conference',
    excerpt:
      'Two presentations at the 13th International Conference on Smart Grid: unsupervised clustering for stability prediction, and a classical–quantum transfer learning model for disturbance detection.',
    descriptionMd: `
Ümit Şentürk presented our work on **unsupervised clustering for stability
prediction** in smart grid systems, and Batuhan Hangın presented a
**classical–quantum transfer learning** model for disturbance detection in power
systems.

The transfer-learning result is the one I keep thinking about: pre-training the
classical encoder on abundant simulated data, then fine-tuning only the
variational circuit on scarce real disturbance events, recovers most of the
benefit of a fully quantum pipeline at a fraction of the circuit depth. On
near-term hardware, circuit depth *is* the budget.
`.trim(),
  },
  {
    title: 'IEEE HPEC 2025 — Hybrid models for QSAR biodegradability',
    slug: 'hpec-2025-qsar',
    activityDate: '2025-09-16',
    location: 'Boston, MA, USA',
    categorySlug: 'conference',
    excerpt:
      'A hybrid classical–quantum model for QSAR-based biodegradability prediction, presented at the IEEE High Performance Extreme Computing Conference.',
    descriptionMd: `
Presented at **IEEE HPEC 2025**. QSAR biodegradability prediction has the same
shape as the problems we work on in energy: high-dimensional descriptors, very
few labelled compounds, and an expensive ground truth.

That structural similarity is deliberate. If the small-data advantage we keep
observing is real, it should transfer across domains that share those
properties — and if it does not transfer, then it was probably an artefact of
our energy datasets all along. Testing it somewhere unfamiliar is the point.
`.trim(),
  },
  {
    title: 'ICRERA 2024 — Offshore wind farm forecasting',
    slug: 'icrera-2024-offshore-wind',
    activityDate: '2024-11-19',
    location: 'Nagasaki, Japan',
    categorySlug: 'conference',
    excerpt:
      'A hybrid quantum–classical machine learning approach to offshore wind farm power forecasting, presented at the 13th ICRERA.',
    descriptionMd: `
Offshore wind is a harder forecasting problem than onshore: fewer sensors, more
expensive maintenance, and wake effects that couple turbines to each other in
ways a per-turbine model cannot see.

We presented a hybrid quantum–classical approach at **ICRERA 2024** in Nagasaki.
`.trim(),
  },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * Build
 * ═══════════════════════════════════════════════════════════════════════════ */

const now = Math.floor(Date.now() / 1000);
const daysAgo = (days: number) => now - days * 86_400;

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '..');

  statements.push(
    [
      '-- ═══════════════════════════════════════════════════════════════════════',
      '-- SEED DATA — Önder Eyecioğlu',
      '--',
      '-- GENERATED FILE. Do not edit by hand.',
      '-- Regenerate with:  npm run seed:build',
      '--',
      '-- Source of truth:',
      '--   seed/publications.bib   — the publication library',
      '--   scripts/build-seed.ts   — everything else (transcribed from the CV)',
      '-- ═══════════════════════════════════════════════════════════════════════',
      '',
      'PRAGMA foreign_keys = ON;',
    ].join('\n'),
  );

  /* ── Wipe (idempotent re-seed) ─────────────────────────────────────────── */
  section('Reset — delete in FK-safe order');
  const tables = [
    'publication_authors', 'publications', 'authors',
    'blog_post_tags', 'blog_post_gallery', 'blog_posts', 'blog_tags', 'blog_categories',
    'activity_images', 'activities', 'activity_categories',
    'skills', 'skill_categories',
    'supervised_theses', 'projects', 'experiences',
    'research_interests', 'memberships', 'awards', 'education',
    'image_slots', 'settings', 'contacts', 'audit_logs', 'sessions',
    'profile', 'media', 'users',
  ];
  statements.push(tables.map((t) => `DELETE FROM ${t};`).join('\n'));
  statements.push(
    `DELETE FROM sqlite_sequence WHERE name IN (${tables.map((t) => `'${t}'`).join(', ')});`,
  );

  /* ── Admin user ───────────────────────────────────────────────────────── */
  section('Administrator');
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  insert('users', [
    {
      id: 1,
      email: ADMIN_EMAIL,
      password_hash: passwordHash,
      name: 'Önder Eyecioğlu',
      role: 'admin',
      must_change_password: true,
      is_active: true,
      created_at: now,
      updated_at: now,
    },
  ]);

  /* ── Profile ──────────────────────────────────────────────────────────── */
  section('Profile');
  const [professionalBioHtml, academicBioHtml] = await Promise.all([
    renderRichText(PROFESSIONAL_BIO),
    renderRichText(ACADEMIC_BIO),
  ]);

  insert('profile', [
    {
      id: 1,
      full_name: 'Önder Eyecioğlu',
      honorific: 'Assoc. Prof. Dr.',
      title: 'Associate Professor of Computer Engineering',
      institution: 'Bolu Abant İzzet Baysal University',
      department: 'Department of Computer Engineering',
      tagline:
        'I build hybrid quantum–classical models for energy systems — and I benchmark them honestly against the classical baselines they are supposed to beat.',
      summary:
        'Associate Professor of Computer Engineering at Bolu Abant İzzet Baysal University, working on quantum machine learning, smart grid forecasting and computational materials science.',
      professional_bio_md: PROFESSIONAL_BIO,
      professional_bio_html: professionalBioHtml,
      academic_bio_md: ACADEMIC_BIO,
      academic_bio_html: academicBioHtml,
      email: 'oeyeci@gmail.com',
      // The mobile number on the CV is deliberately NOT published.
      phone: '+90 374 254 1000',
      office: 'Faculty of Engineering, Gölköy Campus',
      address:
        'Bolu Abant İzzet Baysal Üniversitesi, Mühendislik Fakültesi, Bilgisayar Mühendisliği Bölümü, 14030 Gölköy Kampüsü, Bolu, Türkiye',
      latitude: 40.7135,
      longitude: 31.5217,
      google_maps_url:
        'https://www.google.com/maps/search/?api=1&query=Bolu+Abant+Izzet+Baysal+Universitesi+Muhendislik+Fakultesi',
      orcid: 'https://orcid.org/0000-0002-4142-8382',
      google_scholar: 'https://scholar.google.com/citations?user=placeholder',
      research_gate: 'https://www.researchgate.net/profile/Oender-Eyecioglu',
      github: 'https://github.com/ondereyecioglu',
      linkedin: 'https://www.linkedin.com/in/ondereyecioglu',
      updated_at: now,
    },
  ]);

  /* ── Image slots ──────────────────────────────────────────────────────── */
  section('Image slots (predefined placeholders)');
  insert('image_slots', [
    {
      slug: 'about.portrait',
      label: 'Portrait',
      description: 'Main portrait, used on the home hero and the About page. Portrait 4:5.',
      required_width: null,
      required_height: null,
      aspect_ratio: 0.8,
      tolerance: 0,
      updated_at: now,
    },
    {
      slug: 'about.secondary',
      label: 'About — wide image',
      description: 'Wide supporting image on the About page (lab, teaching, conference). 16:7.',
      required_width: null,
      required_height: null,
      aspect_ratio: 2.2857,
      tolerance: 0,
      updated_at: now,
    },
    {
      slug: 'home.og',
      label: 'Default social share image',
      description: 'Shown when a page is shared and has no image of its own. Exactly 1200×630.',
      required_width: 1200,
      required_height: 630,
      aspect_ratio: null,
      tolerance: 2,
      updated_at: now,
    },
  ]);

  /* ── Research interests, education, awards, memberships ───────────────── */
  section('About — interests, education, awards, memberships');
  insert(
    'research_interests',
    RESEARCH_INTERESTS.map((item, i) => ({
      title: item.title,
      description: item.description,
      is_featured: item.isFeatured,
      sort_order: i,
    })),
  );

  insert(
    'education',
    EDUCATION.map((item, i) => ({
      degree: item.degree,
      field: item.field,
      institution: item.institution,
      department: item.department,
      location: item.location,
      start_year: item.startYear,
      end_year: item.endYear,
      completed_on: item.completedOn,
      thesis_title: item.thesisTitle,
      advisor: item.advisor,
      sort_order: i,
    })),
  );

  insert(
    'awards',
    AWARDS.map((item, i) => ({
      title: item.title,
      issuer: item.issuer,
      year: item.year,
      description: item.description,
      sort_order: i,
    })),
  );

  insert(
    'memberships',
    MEMBERSHIPS.map((item, i) => ({
      organization: item.organization,
      role: item.role,
      start_year: item.startYear,
      end_year: item.endYear,
      sort_order: i,
    })),
  );

  /* ── Experiences ──────────────────────────────────────────────────────── */
  section('Experience');
  const experienceRows = await Promise.all(
    EXPERIENCES.map(async (item, i) => ({
      type: item.type,
      title: item.title,
      organization: item.organization,
      department: item.department,
      location: item.location,
      start_date: item.startDate,
      end_date: item.endDate,
      is_current: item.isCurrent,
      description_md: item.descriptionMd,
      description_html: item.descriptionMd ? await renderRichText(item.descriptionMd) : null,
      is_published: true,
      sort_order: i,
      created_at: now,
      updated_at: now,
    })),
  );
  insert('experiences', experienceRows);

  section('Projects');
  const projectRows = await Promise.all(
    PROJECTS.map(async (item, i) => ({
      title: item.title,
      funder: item.funder,
      grant_number: item.grantNumber,
      role: item.role,
      team: item.team,
      start_date: item.startDate,
      end_date: item.endDate,
      status: item.status,
      scope: item.scope,
      description_md: item.descriptionMd,
      description_html: item.descriptionMd ? await renderRichText(item.descriptionMd) : null,
      is_featured: item.role === 'pi',
      is_published: true,
      sort_order: i,
      created_at: now,
      updated_at: now,
    })),
  );
  insert('projects', projectRows);

  section('Supervised theses');
  insert(
    'supervised_theses',
    THESES.map((item, i) => ({
      student_name: item.studentName,
      title: item.title,
      degree: item.degree,
      year: item.year,
      institution: item.institution,
      status: item.status,
      is_published: true,
      sort_order: i,
    })),
  );

  /* ── Publications (parsed from BibTeX) ────────────────────────────────── */
  section('Publications — parsed from seed/publications.bib');

  const bibtex = readFileSync(resolve(root, 'seed/publications.bib'), 'utf8');
  const { drafts, errors, warnings } = parseBibtexToDrafts(bibtex);

  if (errors.length > 0) {
    console.error('\nBibTeX errors:');
    for (const error of errors) console.error('  •', error);
    process.exit(1);
  }
  for (const warning of warnings) console.warn('  ! ', warning);

  // Author table, deduplicated on the normalised key — exactly as the importer does.
  const SELF_ALIASES = ['Eyecioğlu, Önder', 'Eyecioglu, Onder', 'Eyecioğlu, Ö.'];
  const selfKeys = new Set(SELF_ALIASES.map(normalizeKey));

  const authorIds = new Map<string, number>();
  const authorRows: Array<Record<string, Value>> = [];

  for (const draft of drafts) {
    for (const author of draft.authors) {
      if (author.isOthers || authorIds.has(author.normalized)) continue;
      const id = authorRows.length + 1;
      authorIds.set(author.normalized, id);
      authorRows.push({
        id,
        full_name: author.full,
        last_name: author.last || null,
        first_name: author.first || null,
        normalized: author.normalized,
        is_self: selfKeys.has(author.normalized),
      });
    }
  }
  insert('authors', authorRows);

  // Featured: the three that best represent the current research direction.
  const FEATURED = new Set(['eyecioglu2026qlidnet', 'hangin2025qnnwind', 'eyecioglu2019bxcom']);

  // Illustrative citation counts, so the Scholar-style counters have something
  // to show. Replace with real numbers from the admin panel.
  const CITATIONS: Record<string, number> = {
    dereli2013lowerlimit: 61,
    eyecioglu2016zxcom: 48,
    karabul2015eabf: 44,
    eyecioglu2019bxcom: 39,
    dereli2017vacancy: 24,
    eyecioglu2022kufeki: 19,
    topdagi2018nak: 17,
    toker2019mcnp: 14,
    eyecioglu2017zxcomcompat: 13,
    eyecioglu2019windturbine: 12,
    hangin2022stability: 9,
    eyecioglu2024quantumgrid: 7,
    eyecioglu2023strainenergy: 5,
    eyecioglu2026qlidnet: 2,
  };

  const publicationRows: Array<Record<string, Value>> = [];
  const publicationAuthorRows: Array<Record<string, Value>> = [];

  drafts.forEach((draft: PublicationDraft, index) => {
    const id = index + 1;

    publicationRows.push({
      id,
      cite_key: draft.citeKey,
      entry_type: draft.entryType,
      category: draft.category,
      title: draft.title,
      authors_raw: draft.authorsRaw,
      journal: draft.journal,
      booktitle: draft.booktitle,
      publisher: draft.publisher,
      school: draft.school,
      institution: draft.institution,
      series: draft.series,
      edition: draft.edition,
      address: draft.address,
      volume: draft.volume,
      number: draft.number,
      pages: draft.pages,
      year: draft.year,
      month: draft.month,
      doi: draft.doi,
      url: draft.url,
      pdf_url: draft.pdfUrl,
      project_url: draft.projectUrl,
      code_url: draft.codeUrl,
      slides_url: draft.slidesUrl,
      arxiv_id: draft.arxivId,
      isbn: draft.isbn,
      issn: draft.issn,
      abstract: draft.abstract,
      keywords: draft.keywords,
      note: draft.note,
      bibtex_raw: draft.bibtexRaw,
      ieee_citation: draft.ieeeCitation,
      citation_count: CITATIONS[draft.citeKey] ?? 0,
      is_featured: FEATURED.has(draft.citeKey),
      is_published: true,
      created_at: now,
      updated_at: now,
    });

    let position = 0;
    const seen = new Set<number>();
    for (const author of draft.authors) {
      if (author.isOthers) continue;
      const authorId = authorIds.get(author.normalized);
      if (!authorId || seen.has(authorId)) continue;
      seen.add(authorId);
      publicationAuthorRows.push({
        publication_id: id,
        author_id: authorId,
        position: position++,
        is_corresponding: false,
      });
    }
  });

  insert('publications', publicationRows);
  insert('publication_authors', publicationAuthorRows);

  /* ── Skills ───────────────────────────────────────────────────────────── */
  section('Skills');
  const skillCategoryRows: Array<Record<string, Value>> = [];
  const skillRows: Array<Record<string, Value>> = [];

  SKILL_GROUPS.forEach((group, groupIndex) => {
    const categoryId = groupIndex + 1;
    skillCategoryRows.push({
      id: categoryId,
      name: group.name,
      slug: slugify(group.name),
      description: group.description,
      display_mode: group.displayMode,
      sort_order: groupIndex,
    });

    group.skills.forEach((skill, skillIndex) => {
      const s = skill as {
        name: string;
        level: number;
        levelLabel?: string | null;
        description?: string;
        issuedBy?: string;
        issuedYear?: number;
        credentialId?: string;
      };

      skillRows.push({
        category_id: categoryId,
        name: s.name,
        level: s.level,
        level_label: s.levelLabel ?? null,
        description: s.description ?? null,
        issued_by: s.issuedBy ?? null,
        issued_year: s.issuedYear ?? null,
        credential_id: s.credentialId ?? null,
        // The home page shows a flat strip of the headline technologies.
        is_featured: groupIndex <= 1 && skillIndex < 5,
        sort_order: skillIndex,
      });
    });
  });

  insert('skill_categories', skillCategoryRows);
  insert('skills', skillRows);

  /* ── Blog ─────────────────────────────────────────────────────────────── */
  section('Blog');
  insert(
    'blog_categories',
    BLOG_CATEGORIES.map((category, i) => ({
      id: i + 1,
      name: category.name,
      slug: category.slug,
      description: category.description,
      color: category.color,
      sort_order: i,
    })),
  );

  const categoryIdBySlug = new Map(BLOG_CATEGORIES.map((c, i) => [c.slug, i + 1]));

  const tagNames = [...new Set(BLOG_POSTS.flatMap((post) => post.tags))];
  insert(
    'blog_tags',
    tagNames.map((name, i) => ({ id: i + 1, name, slug: slugify(name) })),
  );
  const tagIdByName = new Map(tagNames.map((name, i) => [name, i + 1]));

  const postRows: Array<Record<string, Value>> = [];
  const postTagRows: Array<Record<string, Value>> = [];

  for (const [index, post] of BLOG_POSTS.entries()) {
    const rendered = await renderMarkdown(post.markdown);
    const id = index + 1;
    const publishedAt = daysAgo(post.daysAgo);

    postRows.push({
      id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      content_md: post.markdown,
      content_html: rendered.html,
      toc: rendered.toc,
      category_id: categoryIdBySlug.get(post.categorySlug) ?? null,
      author_id: 1,
      status: 'published',
      published_at: publishedAt,
      is_featured: post.isFeatured,
      show_toc: true,
      reading_minutes: rendered.readingMinutes,
      view_count: 0,
      created_at: publishedAt,
      updated_at: publishedAt,
    });

    for (const tag of post.tags) {
      postTagRows.push({ post_id: id, tag_id: tagIdByName.get(tag)! });
    }
  }

  insert('blog_posts', postRows);
  insert('blog_post_tags', postTagRows);

  /* ── Activities ───────────────────────────────────────────────────────── */
  section('Activities');
  insert(
    'activity_categories',
    ACTIVITY_CATEGORIES.map((category, i) => ({
      id: i + 1,
      name: category.name,
      slug: category.slug,
      color: category.color,
      sort_order: i,
    })),
  );

  const activityCategoryIdBySlug = new Map(ACTIVITY_CATEGORIES.map((c, i) => [c.slug, i + 1]));

  const activityRows = await Promise.all(
    ACTIVITIES.map(async (activity, i) => ({
      id: i + 1,
      slug: activity.slug,
      title: activity.title,
      activity_date: activity.activityDate,
      location: activity.location,
      category_id: activityCategoryIdBySlug.get(activity.categorySlug) ?? null,
      excerpt: activity.excerpt,
      description_md: activity.descriptionMd,
      description_html: await renderRichText(activity.descriptionMd),
      is_featured: i === 0,
      is_published: true,
      created_at: now,
      updated_at: now,
    })),
  );
  insert('activities', activityRows);

  /* ── Settings ─────────────────────────────────────────────────────────── */
  section('Settings');
  insert('settings', [
    { key: 'site.title', value: JSON.stringify('Önder Eyecioğlu'), group: 'general', updated_at: now },
    {
      key: 'site.description',
      value: JSON.stringify(
        'Associate Professor of Computer Engineering researching quantum machine learning, smart grids and computational materials science.',
      ),
      group: 'seo',
      updated_at: now,
    },
    {
      key: 'publications.selfAliases',
      value: JSON.stringify(SELF_ALIASES),
      group: 'publications',
      updated_at: now,
    },
  ]);

  /* ── Write ────────────────────────────────────────────────────────────── */
  mkdirSync(resolve(root, 'seed'), { recursive: true });
  const outPath = resolve(root, 'seed/seed.sql');
  writeFileSync(outPath, statements.join('\n\n') + '\n', 'utf8');

  const byCategory = drafts.reduce<Record<string, number>>((acc, d) => {
    acc[d.category] = (acc[d.category] ?? 0) + 1;
    return acc;
  }, {});

  console.log('\n✓ seed/seed.sql written\n');
  console.log(`  publications  ${drafts.length}`, JSON.stringify(byCategory));
  console.log(`  authors       ${authorRows.length}`);
  console.log(`  experiences   ${EXPERIENCES.length}`);
  console.log(`  projects      ${PROJECTS.length}`);
  console.log(`  theses        ${THESES.length}`);
  console.log(`  skills        ${skillRows.length} in ${SKILL_GROUPS.length} groups`);
  console.log(`  blog posts    ${BLOG_POSTS.length}`);
  console.log(`  activities    ${ACTIVITIES.length}`);
  console.log('\n  Admin login');
  console.log(`    email     ${ADMIN_EMAIL}`);
  console.log(`    password  ${ADMIN_PASSWORD}`);
  console.log('    (flagged must_change_password — rotate it on first sign-in)\n');
}

await main();
