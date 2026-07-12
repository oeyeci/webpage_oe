/**
 * Tests for the BibTeX → IEEE pipeline.
 *
 * This is the one place in the codebase where a silent bug would be both easy
 * to introduce and embarrassing in public: a mangled surname or a malformed
 * reference is visible on every publication card. The Turkish cases are not
 * decoration — `Eyecio{\u{g}}lu` naively de-braced becomes "Eyeciolu".
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeLatex } from '../src/lib/bibtex/latex';
import { parseBibtex } from '../src/lib/bibtex/parser';
import { formatAuthorsIeee, parseAuthors, parseName, toInitials } from '../src/lib/bibtex/authors';
import { parseBibtexToDrafts, toPublicationDraft } from '../src/lib/bibtex/index';

/* ── LaTeX decoding ─────────────────────────────────────────────────────── */

describe('decodeLatex', () => {
  it('decodes Turkish accents in every brace form', () => {
    assert.equal(decodeLatex('Eyecio{\\u{g}}lu'), 'Eyecioğlu');
    assert.equal(decodeLatex('Eyecio\\u{g}lu'), 'Eyecioğlu');
    assert.equal(decodeLatex('{\\"O}nder'), 'Önder');
    assert.equal(decodeLatex('\\"Onder'), 'Önder');
    assert.equal(decodeLatex('Hang{\\i}n'), 'Hangın');
    assert.equal(decodeLatex('{\\c{S}}ent{\\"u}rk'), 'Şentürk');
    assert.equal(decodeLatex('Kay{\\i}{\\c{s}}l{\\i}'), 'Kayışlı');
    assert.equal(decodeLatex('{\\.I}{\\c{c}}elli'), 'İçelli');
  });

  it('decodes non-Turkish diacritics and ligatures', () => {
    assert.equal(decodeLatex("Poincar\\'e"), 'Poincaré');
    assert.equal(decodeLatex('Schr\\"odinger'), 'Schrödinger');
    assert.equal(decodeLatex('Erd\\H{o}s'), 'Erdős');
    assert.equal(decodeLatex('{\\ss}'), 'ß');
    assert.equal(decodeLatex('\\o{}stergaard'), 'østergaard');
  });

  it('strips capitalisation-protecting braces but keeps the text', () => {
    assert.equal(decodeLatex('{QLID-Net}: A Hybrid {QNN}'), 'QLID-Net: A Hybrid QNN');
  });

  it('unwraps formatting commands and converts dashes', () => {
    assert.equal(decodeLatex('\\textbf{Bold} text'), 'Bold text');
    assert.equal(decodeLatex('pages 10--20'), 'pages 10–20');
    assert.equal(decodeLatex('a --- b'), 'a — b');
    assert.equal(decodeLatex('Ampersand \\& more'), 'Ampersand & more');
  });
});

/* ── Name grammar ───────────────────────────────────────────────────────── */

describe('parseName', () => {
  it('handles "von Last, First"', () => {
    const n = parseName('Eyecio{\\u{g}}lu, {\\"O}nder');
    assert.equal(n.first, 'Önder');
    assert.equal(n.last, 'Eyecioğlu');
    assert.equal(n.full, 'Önder Eyecioğlu');
  });

  it('handles "First von Last"', () => {
    const n = parseName('Ludwig van Beethoven');
    assert.equal(n.first, 'Ludwig');
    assert.equal(n.von, 'van');
    assert.equal(n.last, 'Beethoven');
  });

  it('handles "von Last, Jr, First" — the canonical BibTeX example', () => {
    const n = parseName('de la Vallee Poussin, Jr, Charles Louis');
    assert.equal(n.von, 'de la');
    assert.equal(n.last, 'Vallee Poussin');
    assert.equal(n.jr, 'Jr');
    assert.equal(n.first, 'Charles Louis');
  });

  it('keeps a multi-word surname intact when it has no particle', () => {
    const n = parseName('Vallee Poussin, Charles');
    assert.equal(n.von, '');
    assert.equal(n.last, 'Vallee Poussin');
    assert.equal(n.first, 'Charles');
  });

  it('treats a single token as a surname', () => {
    assert.equal(parseName('Plato').last, 'Plato');
  });

  it('recognises the "others" keyword', () => {
    assert.equal(parseName('others').isOthers, true);
  });

  it('does not split surnames that merely start with "and"', () => {
    const names = parseAuthors('Anderson, Kim and Andrews, Lee');
    assert.equal(names.length, 2);
    assert.equal(names[0]?.last, 'Anderson');
    assert.equal(names[1]?.last, 'Andrews');
  });
});

describe('toInitials', () => {
  it('reduces given names to IEEE initials', () => {
    assert.equal(toInitials('Önder'), 'Ö.');
    assert.equal(toInitials('John Adam'), 'J. A.');
    assert.equal(toInitials('Jean-Pierre'), 'J.-P.');
  });
});

describe('formatAuthorsIeee', () => {
  const names = (n: number) =>
    parseAuthors(
      Array.from({ length: n }, (_, i) => `Last${i}, First${i}`).join(' and '),
    );

  it('uses "and" for two authors and a serial comma for three', () => {
    assert.equal(formatAuthorsIeee(names(1)), 'F. Last0');
    assert.equal(formatAuthorsIeee(names(2)), 'F. Last0 and F. Last1');
    assert.equal(formatAuthorsIeee(names(3)), 'F. Last0, F. Last1, and F. Last2');
  });

  it('collapses to "et al." beyond six authors', () => {
    assert.match(formatAuthorsIeee(names(6)), /, and F\. Last5$/);
    assert.equal(formatAuthorsIeee(names(7)), 'F. Last0 et al.');
  });
});

/* ── Parser robustness ──────────────────────────────────────────────────── */

describe('parseBibtex', () => {
  it('parses quoted, braced and bare values, and @string macros', () => {
    const { entries, errors } = parseBibtex(`
      @string{ieee = "IEEE Transactions on"}
      @article{k1,
        author  = "Doe, Jane",
        title   = {A Title},
        journal = ieee # " Computing",
        volume  = 12,
        year    = 2024,
      }
    `);
    assert.deepEqual(errors, []);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.fields.journal, 'IEEE Transactions on Computing');
    assert.equal(entries[0]?.fields.volume, '12');
    assert.equal(entries[0]?.fields.author, 'Doe, Jane');
  });

  it('ignores comments and @comment blocks', () => {
    const { entries } = parseBibtex(`
      % a leading comment
      @comment{ignore me}
      @book{k2, title = {Kept}, author = {A, B}, year = {2020}}
    `);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.key, 'k2');
  });

  it('survives nested braces in a title', () => {
    const { entries } = parseBibtex('@misc{k3, title = {A {Nested {Deep}} Title}, year={2020}}');
    assert.equal(entries[0]?.fields.title, 'A {Nested {Deep}} Title');
  });

  it('reports an error instead of throwing on unbalanced braces', () => {
    const { errors } = parseBibtex('@article{broken, title = {Never closed');
    assert.equal(errors.length > 0, true);
  });

  it('reports an error when no entries are present', () => {
    assert.equal(parseBibtex('not bibtex at all').errors.length > 0, true);
  });

  it('keeps the verbatim source for lossless re-export', () => {
    const src = '@misc{k4, title = {T}, year = {2021}}';
    assert.equal(parseBibtex(src).entries[0]?.raw, src);
  });
});

/* ── IEEE citation output ───────────────────────────────────────────────── */

describe('toIeeeCitation', () => {
  const cite = (src: string) => {
    const { entries } = parseBibtex(src);
    assert.ok(entries[0], 'expected one entry');
    return toPublicationDraft(entries[0]!).ieeeCitation;
  };

  it('formats a journal article', () => {
    assert.equal(
      cite(`@article{a, author = {Eyecio{\\u{g}}lu, {\\"O}nder and Altun, O{\\u{g}}uz},
             title = {{QLID-Net}}, journal = {IEEE Access}, volume = {14},
             pages = {32118--32133}, year = {2026}, month = {mar},
             doi = {10.1109/ACCESS.2026.3668295}}`),
      'Ö. Eyecioğlu and O. Altun, "QLID-Net," IEEE Access, vol. 14, pp. 32118–32133, Mar. 2026, doi: 10.1109/ACCESS.2026.3668295.',
    );
  });

  it('formats a conference paper with "in Proc."', () => {
    assert.equal(
      cite(`@inproceedings{b, author = {Doe, Jane}, title = {Deep Nets},
             booktitle = {Proceedings of the IEEE Conf. on Vision},
             address = {Bologna, Italy}, pages = {744--749}, year = {2025}}`),
      'J. Doe, "Deep Nets," in Proc. IEEE Conf. on Vision, Bologna, Italy, 2025, pp. 744–749.',
    );
  });

  it('formats a book — title takes a period, not quotes', () => {
    assert.equal(
      cite(`@book{c, author = {Dereli, G{\\"u}lay}, title = {Nanostructures},
             publisher = {Springer}, address = {Cham}, edition = {2nd}, year = {2015}}`),
      'G. Dereli, Nanostructures, 2nd ed. Cham: Springer, 2015.',
    );
  });

  it('formats a PhD thesis', () => {
    assert.equal(
      cite(`@phdthesis{d, author = {Eyecio{\\u{g}}lu, {\\"O}nder}, title = {Carbon Nanotubes},
             school = {Yildiz Technical University}, address = {Istanbul}, year = {2012}}`),
      'Ö. Eyecioğlu, "Carbon Nanotubes," Ph.D. dissertation, Yildiz Technical University, Istanbul, 2012.',
    );
  });

  it('formats a book chapter with editors', () => {
    assert.equal(
      cite(`@incollection{e, author = {Doe, Jane}, title = {A Chapter},
             booktitle = {A Book}, editor = {Smith, John A. and Roe, Ann},
             publisher = {Elsevier}, address = {Amsterdam}, pages = {101--130}, year = {2019}}`),
      'J. Doe, "A Chapter," in A Book, J. A. Smith and A. Roe, Eds., Amsterdam: Elsevier, 2019, pp. 101–130.',
    );
  });

  it('formats a patent', () => {
    assert.equal(
      cite(`@patent{f, author = {Eyecio{\\u{g}}lu, {\\"O}nder}, title = {A System},
             nationality = {Turkish}, number = {2020/17759}, year = {2020}, month = {nov}}`),
      'Ö. Eyecioğlu, "A System," Turkish Patent 2020/17759, Nov. 2020.',
    );
  });

  it('never emits a doubled comma after a quoted title', () => {
    const out = cite('@article{g, author = {A, B}, title = {T}, journal = {J}, year = {2020}}');
    assert.equal(out.includes(',",'), false);
    assert.equal(out, 'B. A, "T," J, 2020.');
  });
});

/* ── Category classification ────────────────────────────────────────────── */

describe('toCategory', () => {
  const categoryOf = (src: string) => parseBibtexToDrafts(src).drafts[0]?.category;

  it('classifies the standard entry types', () => {
    assert.equal(categoryOf('@article{a,title={T},journal={J},year={2020}}'), 'journal');
    assert.equal(categoryOf('@inproceedings{a,title={T},year={2020}}'), 'conference');
    assert.equal(categoryOf('@book{a,title={T},year={2020}}'), 'book');
    assert.equal(categoryOf('@incollection{a,title={T},year={2020}}'), 'chapter');
    assert.equal(categoryOf('@phdthesis{a,title={T},year={2020}}'), 'thesis');
    assert.equal(categoryOf('@mastersthesis{a,title={T},year={2020}}'), 'thesis');
    assert.equal(categoryOf('@patent{a,title={T},year={2020}}'), 'patent');
  });

  it('detects arXiv preprints however the exporter labelled them', () => {
    assert.equal(
      categoryOf('@misc{a,title={T},year={2024},eprint={2401.01234},archivePrefix={arXiv}}'),
      'preprint',
    );
    assert.equal(categoryOf('@misc{a,title={T},year={2024},eprint={2401.01234}}'), 'preprint');
    assert.equal(
      categoryOf('@article{a,title={T},journal={arXiv preprint},year={2024}}'),
      'preprint',
    );
    assert.equal(
      categoryOf('@misc{a,title={T},year={2024},url={https://arxiv.org/abs/2401.01234}}'),
      'preprint',
    );
  });
});

/* ── End-to-end draft mapping ───────────────────────────────────────────── */

describe('parseBibtexToDrafts', () => {
  it('normalises a DOI given as a full URL', () => {
    const { drafts } = parseBibtexToDrafts(
      '@article{a,title={T},year={2020},doi={https://doi.org/10.1109/ACCESS.2026.3668295}}',
    );
    assert.equal(drafts[0]?.doi, '10.1109/ACCESS.2026.3668295');
  });

  it('derives a citation key when the entry has none', () => {
    const { drafts } = parseBibtexToDrafts(
      '@article{, author={Eyecio{\\u{g}}lu, {\\"O}nder}, title={Quantum Machine Learning}, year={2026}}',
    );
    assert.equal(drafts[0]?.citeKey, 'eyecioglu2026quantum');
  });

  it('imports a multi-entry document in one paste', () => {
    const { drafts, errors } = parseBibtexToDrafts(`
      @article{a, title = {One}, journal = {J}, year = {2021}}
      @inproceedings{b, title = {Two}, booktitle = {C}, year = {2022}}
      @book{c, title = {Three}, publisher = {P}, year = {2023}}
    `);
    assert.deepEqual(errors, []);
    assert.equal(drafts.length, 3);
    assert.deepEqual(
      drafts.map((d) => d.category),
      ['journal', 'conference', 'book'],
    );
  });
});
