import test from 'node:test'
import assert from 'node:assert/strict'
import { createSearchIndex, namesKnownTopic, searchIndex } from './searchIndex.js'
import type { WorkspaceDocument } from './workspace.js'

const document: WorkspaceDocument = {
  id: 'products',
  title: 'Productos',
  docType: 'productos',
  section: 'productos',
  content: [
    'Producto: COLAGENASA PLUS PB SERUM',
    'Categoria: Enzimas',
    'Precio: $100',
    '',
    'Producto: ACIDO HIALURONICO',
    'Precio: $200',
    '',
    'Producto: PEPTONAS',
    'Precio: $300',
    '',
    'Producto: LIPOENZIMAS',
    'Precio: $400',
  ].join('\n'),
  isActive: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const index = createSearchIndex({ tenantId: 'tenant', documents: [document] })

test('does not return an unrelated acid product for an absent tranexamic product', () => {
  const result = searchIndex(index, 'precio del acido tranexamico')

  assert.equal(result.matchedBlocks.length, 0)
  assert.equal(result.contextBlock, '(Sin documentos activos)')
})

test('keeps multiple requested product entities in the context', () => {
  const result = searchIndex(index, 'precio del kit de peptonas y lipoenzimas')
  const titles = result.matchedBlocks.map((block) => block.title)

  assert.deepEqual(titles, ['PEPTONAS', 'LIPOENZIMAS'])
})

test('matches PbSerum despite spacing and preserves its category context', () => {
  const result = searchIndex(index, 'informacion producto enzimas pbserum')

  assert.equal(result.matchedBlocks[0]?.title, 'COLAGENASA PLUS PB SERUM')
  assert.match(result.contextBlock, /Categoria: Enzimas/)
  assert.doesNotMatch(result.contextBlock, /ACIDO HIALURONICO/)
})

test('ignores greetings and filler words around a known product', () => {
  const result = searchIndex(index, 'hola buenas tardes, quisiera saber el precio de peptonas')

  assert.equal(result.matchedBlocks[0]?.title, 'PEPTONAS')
  assert.doesNotMatch(result.contextBlock, /ACIDO HIALURONICO/)
})

test('still returns nothing for an absent product asked with greetings', () => {
  const result = searchIndex(index, 'hola, tienen acido tranexamico?')

  assert.equal(result.matchedBlocks.length, 0)
})

const schoolIndex = createSearchIndex({
  tenantId: 'school',
  documents: [
    {
      id: 'courses',
      title: 'cursos.md',
      docType: 'cursos',
      section: 'cursos',
      content: [
        '[CURSO]',
        'Nombre del curso: Russian Lips',
        'Horario presencial: 10:00 AM a 2:00 PM',
        '',
        '[CURSO]',
        'Nombre del curso: Mesobotox',
        'Horario presencial: 9:00 AM a 6:00 PM',
      ].join('\n'),
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'general',
      title: 'infogeneral.md',
      docType: 'general',
      section: 'general',
      content: [
        '[UBICACION]',
        'Nuestra ubicacion es Av. Principal 123, Hermosillo.',
        '',
        '[TELEFONO]',
        'Telefono: 662 000 0000',
      ].join('\n'),
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
})

test('answers a course schedule asked in natural language', () => {
  const result = searchIndex(schoolIndex, 'hola buenas tardes, me gustaria saber el horario del curso de russian lips')

  assert.match(result.contextBlock, /Russian Lips/)
  assert.match(result.contextBlock, /10:00 AM a 2:00 PM/)
})

test('answers a location question whose words are not in the documents', () => {
  const result = searchIndex(schoolIndex, 'donde estan ubicados')

  assert.match(result.contextBlock, /Av\. Principal 123/)
  assert.doesNotMatch(result.contextBlock, /Russian Lips|Mesobotox/)
})

test('does not offer another course for an absent course schedule', () => {
  const result = searchIndex(schoolIndex, 'cual es el horario del curso de microblading')

  assert.doesNotMatch(result.contextBlock, /Russian Lips|Mesobotox/)
})

const treatmentDocs: WorkspaceDocument[] = [
  {
    id: 'trat',
    title: 'tratamientos.md',
    docType: 'markdown',
    section: 'general',
    content: [
      '[TRATAMIENTO: Peptonas]',
      'DURACION: 60 min',
      'REQUIERE VALORACION: Si',
      'PRECIO APROXIMADO: $1,200',
      '',
      '[TRATAMIENTO: Lipoenzimas]',
      'DURACION: 45 min',
      'REQUIERE VALORACION: Si',
      'PRECIO APROXIMADO: $900',
    ].join('\n'),
    isActive: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'info',
    title: 'infogeneral.md',
    docType: 'markdown',
    section: 'general',
    content: '[TRATAMIENTOS_DIRECTOS_CON_LYDIA_CORONADO]\nLydia Coronado aplica tratamientos directos. Agenda por WhatsApp.',
    isActive: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]
const treatmentIndex = createSearchIndex({ tenantId: 'tenant', documents: treatmentDocs })

test('generic treatment question returns the treatment catalog and Lydia block', () => {
  for (const q of ['¿ustedes aplican tratamientos?', 'que tratamientos ofrecen']) {
    const result = searchIndex(treatmentIndex, q)
    assert.match(result.contextBlock, /Peptonas/)
    assert.match(result.contextBlock, /Lipoenzimas/)
    assert.match(result.contextBlock, /LYDIA_CORONADO/)
  }
})

test('specific treatment question finds the treatment block', () => {
  const result = searchIndex(treatmentIndex, 'tratamiento de peptonas para reafirmar gluteos')
  assert.match(result.contextBlock, /Peptonas/)
  assert.match(result.contextBlock, /1,200/)
})

test('absent treatment still returns nothing', () => {
  const result = searchIndex(treatmentIndex, 'tratamiento de botox en la frente')
  assert.equal(result.matchedBlocks.length, 0)
})

test('corrects one-letter typos in treatment names', () => {
  const result = searchIndex(treatmentIndex, 'tratamiento de peptomas para reafirmar gluteos')
  assert.match(result.contextBlock, /1,200/)
})

test('treatments asked by body area return the treatment list', () => {
  for (const q of ['cuentas con tratamientos para la cara?', 'tienes tratamientos faciales?', 'que tratamientos tienen para el rostro']) {
    const result = searchIndex(treatmentIndex, q)
    assert.match(result.contextBlock, /Peptonas/, q)
    assert.match(result.contextBlock, /Lipoenzimas/, q)
  }
})

test('an absent treatment named with a body area still returns nothing', () => {
  const result = searchIndex(treatmentIndex, 'tienen tratamiento de botox para la cara')
  assert.equal(result.matchedBlocks.length, 0)
})

test('the treatment list shows each treatment body area when the document has it', () => {
  const areaIndex = createSearchIndex({
    tenantId: 'tenant',
    documents: [{
      ...treatmentDocs[0],
      content: '[TRATAMIENTO: Peptonas]\nZONA: Cuerpo\nPRECIO APROXIMADO: $1,200\n\n[TRATAMIENTO: Hidrofacial]\nZONA: Rostro\nPRECIO APROXIMADO: $800',
    }],
  })
  const result = searchIndex(areaIndex, 'cuentas con tratamientos para la cara?')

  assert.match(result.contextBlock, /Hidrofacial \| Zona: Rostro/)
  assert.match(result.contextBlock, /Peptonas \| Zona: Cuerpo/)
})

const facialCoursesIndex = createSearchIndex({
  tenantId: 'tenant',
  documents: [
    {
      id: 'courses',
      title: 'cursos.md',
      docType: 'cursos',
      section: 'cursos',
      content: [
        '[CURSO]', 'Nombre del curso: Hidrofacial', 'Descripcion: Limpieza profunda del rostro.', 'Precio: $895 MXN', '',
        '[CURSO]', 'Nombre del curso: Russian Lips', 'Descripcion: Diseno de labios.', 'Precio: $895 MXN', '',
        '[CURSO]', 'Nombre del curso: Maderoterapia', 'Descripcion: Moldeado corporal con rodillos.', 'Precio: $895 MXN',
      ].join('\n'),
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    ...treatmentDocs,
  ],
})

test('courses asked by body area list the courses for that area, not the treatments', () => {
  for (const q of ['cuentas con cursos para tratamiento facial?', 'cursos para la cara', 'que cursos tienen de rostro']) {
    const result = searchIndex(facialCoursesIndex, q)
    assert.match(result.contextBlock, /Hidrofacial/, q)
    assert.match(result.contextBlock, /Russian Lips/, q)
    assert.doesNotMatch(result.contextBlock, /Maderoterapia|LYDIA_CORONADO/, q)
  }
})

test('treatments asked by body area still return the treatment list when courses exist', () => {
  const result = searchIndex(facialCoursesIndex, 'cuentas con tratamientos para la cara?')
  assert.match(result.contextBlock, /LISTA DE TRATAMIENTOS/)
})

test('a narrow area that names a treatment finds that treatment, not the whole list', () => {
  const lipsIndex = createSearchIndex({
    tenantId: 'tenant',
    documents: [{
      ...treatmentDocs[0],
      content: '[TRATAMIENTO: Relleno de labios con HP]\nDURACION: 2.5 horas\nPRECIO APROXIMADO: $3,850\n\n[TRATAMIENTO: Peptonas]\nPRECIO APROXIMADO: $1,200',
    }],
  })
  const result = searchIndex(lipsIndex, 'tratamiento de labios')

  assert.doesNotMatch(result.contextBlock, /LISTA DE TRATAMIENTOS/)
  assert.match(result.contextBlock, /DURACION: 2\.5 horas/)
})

const acidProductsIndex = createSearchIndex({
  tenantId: 'tenant',
  documents: [{
    ...document,
    content: [
      '[PRODUCTO]', 'Nombre del producto: Aguja en U 12 x 0.20', 'Familia: Ácido Hialurónico', 'Precio: $15 MXN', '',
      '[PRODUCTO]', 'Nombre del producto: Rejuveness Plus', 'Familia: Ácido Hialurónico', 'Precio: $900 MXN', '',
      '[PRODUCTO]', 'Nombre del producto: Acido hialuronico - Revofil Plus 1ml', 'Familia: Ácido Hialurónico', 'Precio: $1,690 MXN',
    ].join('\n'),
  }],
})

test('a short word like "en" does not match inside product names', () => {
  const result = searchIndex(acidProductsIndex, 'tienen ácido hialurónico en existencia?')
  assert.equal(result.matchedBlocks[0]?.title, 'Acido hialuronico - Revofil Plus 1ml')
})

test('a [CURSO] heading stays with its card instead of becoming an empty block', () => {
  const titles = schoolIndex.blocks.filter((block) => block.document.id === 'courses').map((block) => block.title)
  assert.deepEqual(titles, ['Russian Lips', 'Mesobotox'])
})

const syllabusIndex = createSearchIndex({
  tenantId: 'tenant',
  documents: [{
    id: 'courses',
    title: 'cursos.md',
    docType: 'cursos',
    section: 'cursos',
    content: [
      '[TEMARIOS]', '', 'FIBROBLAST', '[Temario]', 'Temario FIBROBLAST', 'Plasma Pen', 'Estructura de la piel', '',
      'PDRN SALMÓN', '[Temario]', 'Temario:', 'Mecanismo de acción', 'Evidencia clínica', '',
      '[CURSO]', 'Nombre del curso: Bioestimulación con PDRN de salmón.', 'Precio: $895 MXN',
    ].join('\n'),
    isActive: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }],
})

test('a syllabus keeps the course name written above its [Temario] heading', () => {
  const result = searchIndex(syllabusIndex, 'temario de pdrn salmon')
  assert.match(result.contextBlock, /Mecanismo de acción/)
  assert.doesNotMatch(result.contextBlock, /Estructura de la piel/)
})

const courseAndProductIndex = createSearchIndex({
  tenantId: 'tenant',
  documents: [
    facialCoursesIndex.documents[0],
    {
      ...document,
      content: [
        '[CURSO]', 'Nombre del curso: Lipoenzimas', 'Precio: $895 MXN', '',
      ].join('\n'),
      id: 'more-courses',
      section: 'cursos',
      docType: 'cursos',
    },
    {
      ...document,
      content: Array.from({ length: 15 }, (_, i) => [
        '[PRODUCTO]',
        `Nombre del producto: ${i === 0 ? 'DUO LIPOENZIMAS PRODERM' : `Producto ${i}`}`,
        `Familia: ${i % 2 ? 'Ácido Hialurónico' : 'Enzimas'}`,
        'Stock / Disponibilidad: 3 unidades disponibles',
        'Precio: $100 MXN',
        '',
      ].join('\n')).join('\n'),
    },
  ],
})

test('a course list question lists every course and no products', () => {
  for (const q of ['que cursos tienen', 'que cursos tienen disponibles?']) {
    const result = searchIndex(courseAndProductIndex, q)
    for (const name of ['Hidrofacial', 'Russian Lips', 'Maderoterapia', 'Lipoenzimas']) {
      assert.match(result.contextBlock, new RegExp(name), q)
    }
    assert.doesNotMatch(result.contextBlock, /PRODUCTO|Producto \d|PRODERM/, q)
  }
})

test('a course price question ranks the course above a product with the same name', () => {
  const result = searchIndex(courseAndProductIndex, 'cuanto cuesta el curso de lipoenzimas')
  assert.equal(result.matchedBlocks[0]?.title, 'Lipoenzimas')
})

test('a product list question summarizes a large catalog by category', () => {
  const result = searchIndex(courseAndProductIndex, 'que productos venden')
  assert.match(result.contextBlock, /Ácido Hialurónico \(7 productos\)/)
  assert.match(result.contextBlock, /Enzimas \(8 productos\)/)
  assert.doesNotMatch(result.contextBlock, /Hidrofacial/)
})

test('understands a course question written with typos in common words', () => {
  for (const q of ['ienes crsos para fciales o cra', 'tiness dispinbile cursos apra la cara?']) {
    const result = searchIndex(facialCoursesIndex, q)
    assert.match(result.contextBlock, /Hidrofacial/, q)
    assert.match(result.contextBlock, /Russian Lips/, q)
    assert.doesNotMatch(result.contextBlock, /Maderoterapia/, q)
  }
})

test('does not "correct" a word that exists in the documents', () => {
  const verrugasIndex = createSearchIndex({
    tenantId: 'tenant',
    documents: [{
      ...facialCoursesIndex.documents[0],
      content: '[CURSO]\nNombre del curso: Fibroblast\nDescripcion: Eliminacion de verrugas.\n\n[CURSO]\nNombre del curso: Verrugas Plus\nPrecio: $1',
    }],
  })
  const result = searchIndex(verrugasIndex, 'curso para eliminacion de verrugas')
  assert.match(result.contextBlock, /Fibroblast/)
})

const wholeOfferIndex = createSearchIndex({
  tenantId: 'tenant',
  documents: [
    courseAndProductIndex.documents[0],
    courseAndProductIndex.documents[2],
    treatmentDocs[0],
  ],
})

test('asking what the business offers, with any verb or typo, gets an overview of every section', () => {
  for (const q of ['que servicios brindan?', 'que servicios birndan?', 'que servicios ofrecen?', 'que ofrecen?', 'que servicios dan']) {
    const result = searchIndex(wholeOfferIndex, q)
    assert.match(result.contextBlock, /Cursos \(3\): Hidrofacial, Russian Lips, Maderoterapia/, q)
    assert.match(result.contextBlock, /Tratamientos \(2\): Peptonas, Lipoenzimas/, q)
    // 15 products: by category, never the first few as if they were all
    assert.match(result.contextBlock, /Productos \(15\), por categoria: Enzimas \(8\), Ácido Hialurónico \(7\)/, q)
    assert.doesNotMatch(result.contextBlock, /Producto 3/, q)
  }
})

const placeIndex = createSearchIndex({
  tenantId: 'tenant',
  documents: [
    {
      ...facialCoursesIndex.documents[0],
      content: [
        '[CURSO]', 'Nombre del curso: Hidrofacial', 'Modalidades: Online, Presencial', 'Precio: Online: $895 MXN / Presencial: $2850 MXN', '',
        '[CURSO]', 'Nombre del curso: Russian Lips', 'Modalidades: Online', 'Precio: Online: $895 MXN',
      ].join('\n'),
    },
    {
      id: 'general',
      title: 'infogeneral.md',
      docType: 'general',
      section: 'general',
      content: '[CURSOS_SUCURSALES]\nLos cursos presenciales se imparten solo en nuestra sede de Hermosillo, Sonora.\n\n[UBICACION]\nAv. Principal 123, Hermosillo.',
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
})

test('a city named only in the location blocks is not taken for an item name', () => {
  const result = searchIndex(placeIndex, 'tiene scursos en hermosillo?')
  assert.match(result.contextBlock, /Hidrofacial/)
  assert.match(result.contextBlock, /Russian Lips/)
  // where the courses are given comes along
  assert.match(result.contextBlock, /solo en nuestra sede de Hermosillo/)
})

test('the course prices are found when the previous question is searched along', () => {
  const result = searchIndex(placeIndex, 'tiene scursos en hermosillo?\ncuales son los precios?')
  assert.match(result.contextBlock, /Hidrofacial.*\$2850 MXN/)
  assert.match(result.contextBlock, /Russian Lips.*\$895 MXN/)
})

test('a follow-up that names nothing is told apart from a question that names something', () => {
  for (const q of ['cuales son los precios?', 'y en linea?', 'cuanto cuesta?', 'y las fechas?', 'cuando empieza?']) {
    assert.equal(namesKnownTopic(placeIndex, q), false, q)
  }
  for (const q of ['precio del hidrofacial', 'que cursos tienen', 'donde estan ubicados', 'russian lips online']) {
    assert.equal(namesKnownTopic(placeIndex, q), true, q)
  }
})

test('a misspelled city is corrected with the places in the business location blocks', () => {
  for (const q of ['tienes cursos en hermosllo?', 'tienes cursos en hermsoillo?', 'tienes cursos en Hermosiyo?']) {
    const result = searchIndex(placeIndex, q)
    assert.match(result.contextBlock, /Hidrofacial/, q)
    assert.match(result.contextBlock, /solo en nuestra sede de Hermosillo/, q)
  }

  const guadalajaraIndex = createSearchIndex({
    tenantId: 'tenant',
    documents: [
      placeIndex.documents[0],
      { ...placeIndex.documents[1], content: '[SUCURSALES]\nTenemos sede en Guadalajara, Jalisco.' },
    ],
  })
  const result = searchIndex(guadalajaraIndex, 'tienen cursos en guadalajra?')
  assert.match(result.contextBlock, /Hidrofacial/)
  assert.match(result.contextBlock, /sede en Guadalajara/)
})

test('a city where the business has no branch still gets the courses and where they are given', () => {
  const result = searchIndex(placeIndex, 'tienen cursos en monterrey?')
  assert.match(result.contextBlock, /Hidrofacial/)
  assert.match(result.contextBlock, /solo en nuestra sede de Hermosillo/)
})

test('an absent item is still not taken for a place', () => {
  const result = searchIndex(placeIndex, 'tienen curso de microblading?')
  assert.doesNotMatch(result.contextBlock, /Hidrofacial|Russian Lips/)
})
