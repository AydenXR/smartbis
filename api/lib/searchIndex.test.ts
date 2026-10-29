import test from 'node:test'
import assert from 'node:assert/strict'
import { createSearchIndex, keepDocumentWords, namesKnownTopic, searchIndex } from './searchIndex.js'
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
  assert.match(result.contextBlock, /Ácido Hialurónico \(7 productos[,)]/)
  assert.match(result.contextBlock, /Enzimas \(8 productos[,)]/)
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

test('an ad title keeps only the words the business documents use, without campaign codes', () => {
  const adIndex = createSearchIndex({
    tenantId: 'tenant',
    documents: [{
      ...facialCoursesIndex.documents[0],
      content: [
        '[CURSO]', 'Nombre del curso: Relleno de arrugas y revitalización con Hyaluron Pen', 'Precio: $895 MXN', '',
        '[CURSO]', 'Nombre del curso: Russian Lips', 'Precio: $895 MXN',
      ].join('\n'),
    }],
  })
  assert.equal(keepDocumentWords(adIndex, 'Relleno de arrugas MXMSVI 1026_Group_1_Image'), 'relleno de arrugas')
  assert.equal(keepDocumentWords(adIndex, 'Russian Lips USMSVI 1026'), 'russian lips')
  assert.equal(keepDocumentWords(adIndex, 'Campaña MXMSVI 0926_Group_1_Image'), '')

  const result = searchIndex(adIndex, `${keepDocumentWords(adIndex, 'Relleno de arrugas MXMSVI 1026_Group_1_Image')}\ninformacion`)
  assert.match(result.contextBlock, /Relleno de arrugas y revitalización/)
  assert.doesNotMatch(result.contextBlock, /Russian Lips/)
})

test('asking whether the business sells gets the product catalog, even with unknown words around', () => {
  for (const q of [
    'Buenas tardes, me gustaria saber si daran datos de proveedores o ustedes venden?',
    'ustedes venden?',
    'hacen venta al publico?',
    'disponen de productos?',
    'cuentan con productos en venta?',
  ]) {
    const result = searchIndex(courseAndProductIndex, q)
    assert.match(result.contextBlock, /Ácido Hialurónico \(7 productos[,)]/, q)
    assert.match(result.contextBlock, /Enzimas \(8 productos[,)]/, q)
  }
})

test('a product that does not exist is still not answered with the catalog', () => {
  assert.equal(searchIndex(index, 'venden acido tranexamico?').matchedBlocks.length, 0)
  assert.equal(searchIndex(index, 'precio del acido tranexamico').matchedBlocks.length, 0)
})

test('asking whether they sell courses gets the courses, not the products', () => {
  const result = searchIndex(courseAndProductIndex, 'venden cursos?')
  assert.match(result.contextBlock, /Hidrofacial/)
  assert.doesNotMatch(result.contextBlock, /Enzimas \(8 productos[,)]/)
})

test('asking whether they sell is a topic of its own, not a follow-up of the previous question', () => {
  assert.equal(namesKnownTopic(courseAndProductIndex, 'Buenas tardes, me gustaria saber si daran datos de proveedores o ustedes venden?'), true)
  assert.equal(namesKnownTopic(courseAndProductIndex, 'ustedes venden?'), true)
  assert.equal(namesKnownTopic(courseAndProductIndex, 'cuales son los precios?'), false)
})

test('a word that only names a general block, like DATOS_BANCARIOS, does not stop the product catalog', () => {
  const withBankData = createSearchIndex({
    tenantId: 'tenant',
    documents: [
      ...courseAndProductIndex.documents,
      {
        id: 'info',
        title: 'infogeneral.md',
        docType: 'empresa',
        section: 'general',
        content: '[DATOS_BANCARIOS_PUBLICOS]\nBANCO EJEMPLO cuenta 0123\n\n[DATOS_FISCALES_Y_RFC]\nRFC EJEMPLO',
        isActive: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  })
  const result = searchIndex(withBankData, 'Buenas tardes, me gustaria saber si daran datos de proveedores o ustedes venden?')
  assert.match(result.contextBlock, /Ácido Hialurónico \(7 productos[,)]/)
  assert.doesNotMatch(result.contextBlock, /BANCO EJEMPLO|RFC EJEMPLO/)
})

const staffIndex = createSearchIndex({
  tenantId: 'tenant',
  documents: [
    {
      ...facialCoursesIndex.documents[0],
      content: [
        '[CURSO]', 'Nombre del curso: Limpiezas faciales', 'Duración: 4 horas', 'Temario: extracción, exfoliación, mascarillas', 'Precio: $595 MXN', '',
        '[CURSO]', 'Nombre del curso: Russian Lips', 'Precio: $895 MXN',
      ].join('\n'),
    },
    {
      id: 'info',
      title: 'infogeneral.md',
      docType: 'empresa',
      section: 'general',
      content: '[PERSONAL_CLAVE]\nDra. Ejemplo: directora.',
      isActive: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
})

test('a question about a course syllabus or length is a follow-up, not a new topic', () => {
  // "clase" must not be "corrected" into "clave" from a general block title
  assert.equal(namesKnownTopic(staffIndex, 'Que temas trata la clase y cuanto tiempo es?'), false)
  assert.equal(namesKnownTopic(staffIndex, 'cuanto dura?'), false)
  assert.equal(namesKnownTopic(staffIndex, 'y el temario?'), false)
  assert.equal(namesKnownTopic(staffIndex, 'temario de russian lips'), true)

  const result = searchIndex(staffIndex, 'curso de limpieza facial tienes?\nQue temas trata la clase y cuanto tiempo es?')
  assert.match(result.contextBlock, /Duración: 4 horas/)
  assert.match(result.contextBlock, /extracción, exfoliación/)
  assert.doesNotMatch(result.contextBlock, /directora/)
})

test('card fields are read even when their lines start with spaces, as in the database documents', () => {
  const indented = createSearchIndex({
    tenantId: 'tenant',
    documents: [{
      ...facialCoursesIndex.documents[0],
      content: '[CURSO]\n Nombre del curso: Limpiezas faciales.\n\n Modalidades: Online, Presencial\n\n Precio: Online: $595 MXN\n\n[CURSO]\n Nombre del curso: Russian Lips\n Precio: $895 MXN',
    }],
  })
  assert.deepEqual(indented.blocks.map((block) => block.title), ['Limpiezas faciales.', 'Russian Lips'])
  assert.equal(indented.blocks[0].fields.price, 'Online: $595 MXN')
  const list = searchIndex(indented, 'que cursos tienen?')
  assert.match(list.contextBlock, /- Limpiezas faciales\. \| Modalidades: Online, Presencial \| Precio: Online: \$595 MXN/)
})

test('asking for the syllabus or length after an area question gets course details, not the name list', () => {
  const detailsIndex = createSearchIndex({
    tenantId: 'tenant',
    documents: [{
      ...facialCoursesIndex.documents[0],
      content: [
        '[HORARIOS]', 'Presencial:', '10:00 AM - 2:30 PM', '- Limpiezas faciales', '', '[FECHAS_CURSOS]', 'En línea:', '✨ 04 Noviembre - Limpieza facial', '',
        '[CURSO]', ' Nombre del curso: Limpiezas faciales.', ' Descripción: Limpieza y cuidado de la piel del rostro.', ' Precio: $595 MXN', '',
        'Limpiezas faciales', '[Temario]', 'Temario: Limpiezas faciales', 'Tipos de piel', 'Extracción', '',
        '[CURSO]', ' Nombre del curso: Hidrofacial', ' Descripción: Limpieza profunda facial.', ' Precio: $895 MXN',
      ].join('\n'),
    }],
  })
  const result = searchIndex(detailsIndex, 'tienes curso de facial?\nQue temas trata la clase  y cuanto tiempo es?')
  assert.doesNotMatch(result.contextBlock, /^Catalogo resumido/)
  assert.match(result.contextBlock, /Tipos de piel/)
  assert.match(result.contextBlock, /10:00 AM - 2:30 PM/)
})

test('asking for free or cheap courses lists the courses with their prices, not nothing', () => {
  for (const q of ['tienes cursos gratuitos?', 'hay cursos gratis?', 'tienen algun curso economico?']) {
    const result = searchIndex(facialCoursesIndex, q)
    assert.match(result.contextBlock, /Hidrofacial/, q)
    assert.match(result.contextBlock, /Maderoterapia/, q)
    assert.match(result.contextBlock, /\$895 MXN/, q)
  }
})

test('asking for a course by price lists the courses with their prices', () => {
  for (const q of ['tienes cursos de 100 pesos?', 'hay cursos de 1500 pesos?']) {
    const result = searchIndex(facialCoursesIndex, q)
    assert.match(result.contextBlock, /Hidrofacial/, q)
    assert.match(result.contextBlock, /\$895 MXN/, q)
  }
})

test('a long product catalog summary shows the lowest real price of each category', () => {
  const products = Array.from({ length: 60 }, (_, i) => [
    '[PRODUCTO]', `Nombre del producto: Aguja ${i + 1}`, 'Categoría: Insumos', `Precio: $${i === 0 ? 0 : 10 + i} MXN`, '',
  ].join('\n'))
  const catalog = createSearchIndex({ tenantId: 'tenant', documents: [{
    id: 'products', title: 'productos.md', docType: 'productos', section: 'productos', content: products.join('\n'),
    isActive: true, updatedAt: '2026-01-01T00:00:00.000Z',
  }] })
  for (const q of ['tienes productos gratis?', 'cuentas con productos de muestra?']) {
    const result = searchIndex(catalog, q)
    assert.match(result.contextBlock, /Insumos \(60 productos, desde \$11 MXN\)/, q)
  }
})

test('a typo the documents also make, like "produtos" in a FAQ, is still corrected', () => {
  const products = Array.from({ length: 20 }, (_, i) => [
    '[PRODUCTO]', `Nombre del producto: Aguja ${i + 1}`, 'Categoría: Insumos', 'Descripción: Insumo para productos de belleza.', `Precio: $${10 + i} MXN`, '',
  ].join('\n'))
  const catalog = createSearchIndex({ tenantId: 'tenant', documents: [
    { id: 'products', title: 'productos.md', docType: 'productos', section: 'productos', content: products.join('\n'), isActive: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'faqs', title: 'faqs.md', docType: 'general', section: 'general', content: '[FAQ]\nPregunta: Como puedo adquirir sus produtos?\nRespuesta: Por WhatsApp.', isActive: true, updatedAt: '2026-01-01T00:00:00.000Z' },
  ] })
  const result = searchIndex(catalog, 'tienes produtos de muestra?')
  assert.equal(result.intent.wantsProducts, true)
  assert.match(result.contextBlock, /Insumos \(20 productos, desde \$10 MXN\)/)
})

test('asking for products or courses of an amount lists the items priced around it', () => {
  const products = [['Aguja', '$3 MXN'], ['Mascarilla', '$938 MXN'], ['Kit flacidez', '$1,050 MXN'], ['Dermapen', '$1,250 MXN'], ['Plasma pen', '$9,000 MXN']]
    .map(([name, price]) => `[PRODUCTO]\nNombre del producto: ${name}\nCategoría: Insumos\nPrecio: ${price}\n`)
  const courses = ['[CURSO]\nNombre del curso: Peptonas\nPrecio: Online: $595 MXN ($33 USD) / Presencial: $1350 MXN\n', '[CURSO]\nNombre del curso: BB Glow\nPrecio: Online: $895 MXN ($48 USD) / Presencial: $2850 MXN\n']
  const catalog = createSearchIndex({ tenantId: 'tenant', documents: [
    { id: 'products', title: 'productos.md', docType: 'productos', section: 'productos', content: products.join('\n'), isActive: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'courses', title: 'cursos.md', docType: 'cursos', section: 'cursos', content: courses.join('\n'), isActive: true, updatedAt: '2026-01-01T00:00:00.000Z' },
  ] })

  for (const q of ['tiene sproductos de mil pesos?', 'productos de 1,000?', 'tienes productos de $1000']) {
    const result = searchIndex(catalog, q)
    assert.match(result.contextBlock, /cercano a \$1000/, q)
    assert.match(result.contextBlock, /Kit flacidez/, q)
    assert.match(result.contextBlock, /Mascarilla/, q)
    assert.doesNotMatch(result.contextBlock, /Plasma pen/, q)
  }

  const cheap = searchIndex(catalog, 'tienes cursos de 100 pesos?')
  assert.match(cheap.contextBlock, /Ningun elemento cuesta cerca de \$100; los precios van de \$595 a \$2850/)
  const inPerson = searchIndex(catalog, 'cursos de dos mil quinientos pesos')
  assert.match(inPerson.contextBlock, /cercano a \$2500/)
  assert.match(inPerson.contextBlock, /BB Glow/)
  assert.doesNotMatch(inPerson.contextBlock, /Peptonas/)
})

test('asking for a course leaves out a treatment with the same name when there is a course for it', () => {
  const both = createSearchIndex({ tenantId: 'tenant', documents: [
    { id: 'courses', title: 'cursos.md', docType: 'cursos', section: 'cursos', isActive: true, updatedAt: '2026-01-01T00:00:00.000Z', content: [
      '[FECHAS_CURSOS]', 'En línea:', '✨ 03 Noviembre - Rejuvenecimiento facial en tercio superior (Botox superior)', '',
      '[CURSO]', 'Nombre del curso: Toxina Botulínica: Tercio superior.', 'Descripción: Aplicación de toxina en el tercio superior facial.', 'Precio: $895 MXN',
    ].join('\n') },
    { id: 'treatments', title: 'tratamientos.md', docType: 'general', section: 'general', isActive: true, updatedAt: '2026-01-01T00:00:00.000Z', content: [
      '[TRATAMIENTO: Rejuvenecimiento facial - Tercio superior]', 'DURACION: 2 horas.', 'PRECIO APROXIMADO: $1,300',
    ].join('\n') },
  ] })

  const course = searchIndex(both, 'Mas informacion del curso rejuvenecimiento facial tercio superior')
  assert.ok(course.matchedBlocks.some((block) => block.title.startsWith('Toxina Botulínica')))
  assert.ok(!course.matchedBlocks.some((block) => block.document.id === 'treatments'))

  const treatment = searchIndex(both, 'informacion del tratamiento rejuvenecimiento facial tercio superior')
  assert.ok(treatment.matchedBlocks.some((block) => block.document.id === 'treatments'))
})
