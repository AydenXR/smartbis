#!/bin/bash
# SmartBis Universal Deployment Wizard v3.0 - "Multi-Business Turnkey"
# Creado por SmartBis para despliegues dinámicos.

# --- CONFIGURACIÓN DE COLORES ---
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Función de texto con efecto de máquina de escribir
type_text() {
    text="$1"
    for (( i=0; i<${#text}; i++ )); do
        echo -n "${text:$i:1}"
        sleep 0.01
    done
    echo ""
}

# --- VERIFICACIÓN DE DEPENDENCIAS ---
check_system() {
    echo -e "${YELLOW}[ PASO 0: VERIFICANDO SISTEMA ]${NC}"
    if ! [ -x "$(command -v docker)" ]; then
        echo -e "${BLUE}SmartBis:${NC} No encontré Docker. Lo instalaré por ti..."
        curl -fsSL https://get.docker.com | sh
        sudo usermod -aG docker $USER
    fi
    if ! [ -x "$(command -v docker-compose)" ]; then
        echo -e "${BLUE}SmartBis:${NC} Instalando Docker Compose..."
        sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
        sudo chmod +x /usr/local/bin/docker-compose
    fi
    echo -e "✅ Sistema listo para despegar."
}

# Función para encontrar un puerto libre
find_free_port() {
    local port=$1
    while lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; do
        port=$((port + 1))
    done
    echo $port
}

clear
echo -e "${BLUE}"
echo "   _____                      _   ____  _     "
echo "  / ____|                    | | |  _ \(_)    "
echo " | (___  _ __ ___   __ _ _ __| |_| |_) |_ ___ "
echo "  \___ \| '_ ' _ \ / _' | '__| __|  _ <| / __|"
echo "  ____) | | | | | | (_| | |  | |_| |_) | \__ \""
echo " |_____/|_| |_| |_|\__,_|_|   \__|____/|_|___/"
echo -e "${NC}"

echo -e "${CYAN}====================================================${NC}"
type_text "¡Bienvenido al Asistente de Configuración de SmartBis!"
type_text "Este script te guiará paso a paso para dejar tu empresa lista."
echo -e "${CYAN}====================================================${NC}"
echo ""

check_system
sleep 1

# --- PASO 1: IDENTIFICADOR DE INSTANCIA ---
echo -e ""
echo -e "${YELLOW}[ PASO 1: IDENTIDAD DEL PROYECTO ]${NC}"
echo -e "Este ID se usará para nombrar tus contenedores y base de datos."
INSTANCE_DEFAULT=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
echo -en "${CYAN}SmartBis:${NC} ¿Qué ID le daremos a esta instancia? [Default: $INSTANCE_DEFAULT]: "
read INSTANCE_ID
INSTANCE_ID=${INSTANCE_ID:-$INSTANCE_DEFAULT}
COMPOSE_PROJECT_NAME=$(echo "$INSTANCE_ID" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

# --- PASO 2: REDES ---
echo -e ""
echo -e "${YELLOW}[ PASO 2: CONFIGURACIÓN DE RED ]${NC}"
echo -en "${CYAN}SmartBis:${NC} Escaneando puertos disponibles..."

FREE_BOT=$(find_free_port 3000)
FREE_FRONT=$(find_free_port 4173)
FREE_DB=$(find_free_port 6333)

echo -e ""
echo -e "✅ Puertos asignados automáticamente:"
echo -e "   - Bot (Puerto API): ${GREEN}$FREE_BOT${NC}"
echo -e "   - Panel de Control: ${GREEN}$FREE_FRONT${NC}"
echo -e "   - Base de Datos:    ${GREEN}$FREE_DB${NC}"

# --- PASO 3: DATOS DEL NEGOCIO ---
echo -e ""
echo -e "${YELLOW}[ PASO 3: CORAZÓN DE TU NEGOCIO ]${NC}"
echo -e "Estos datos son los que el Bot usará para presentarse ante tus clientes."

if [ -f .env ]; then
    source .env
    echo -e "📝 He detectado una configuración previa para: ${CYAN}$APP_NAME${NC}"
    echo -en "   ¿Deseas mantener estos datos? (S/n): "
    read KEEP_OLD
    if [[ "$KEEP_OLD" == "n" || "$KEEP_OLD" == "N" ]]; then
        read -p "📌 Nombre de la Empresa (ej: Clínica Dental): " APP_NAME
        read -p "📌 ¿Qué ofreces? (ej: Consultas dentales, Limpiezas): " ITEM_NAME
        read -p "📌 Prefijo para Tickets (ej: DENT-): " TICKET_PREFIX
        read -p "📌 Dirección Física compelta: " BUSINESS_ADDRESS
        read -p "📌 Teléfono de Atención: " BUSINESS_PHONE
        read -p "📌 Categoría (ej: Salud, Restaurante, Taller): " BUSINESS_TYPE
    fi
else
    read -p "📌 Nombre de la Empresa: " APP_NAME
    read -p "📌 ¿Qué ofreces? (ej: Pizzas, Reparaciones): " ITEM_NAME
    read -p "📌 Prefijo para Tickets (ej: SB-): " TICKET_PREFIX
    read -p "📌 Dirección Física completa: " BUSINESS_ADDRESS
    read -p "📌 Teléfono de Atención: " BUSINESS_PHONE
    read -p "📌 Categoría de Negocio: " BUSINESS_TYPE
fi

# --- PASO 4: SEGURIDAD Y LLAVES ---
echo -e ""
echo -e "${YELLOW}[ PASO 4: CONEXIONES Y SEGURIDAD ]${NC}"
echo -e "Para que el Bot funcione, necesitamos conectar las APIs externas."

# XAI_API_KEY
echo -e "\n1. ${CYAN}XAI API KEY${NC}: Necesaria para la inteligencia del Bot."
read -p "   Ingresa tu KEY [$XAI_API_KEY]: " NEW_XAI_KEY
XAI_KEY=${NEW_XAI_KEY:-$XAI_API_KEY}

# FB_TOKENS
echo -e "\n2. ${CYAN}FACEBOOK/MESSENGER${NC}: Si usarás Messenger."
read -p "   Page Access Token [$FB_PAGE_ACCESS_TOKEN]: " NEW_FB_TOKEN
FB_TOKEN=${NEW_FB_TOKEN:-$FB_PAGE_ACCESS_TOKEN}

read -p "   Verify Token [$FB_VERIFY_TOKEN]: " NEW_FB_VERIFY
FB_VERIFY=${NEW_FB_VERIFY:-$FB_VERIFY_TOKEN}

# ADMIN PASSWORD
echo -e "\n3. ${CYAN}ADMIN PANEL${NC}: Contraseña para entrar al dashboard."
read -p "   Nueva contraseña [$ADMIN_PASSWORD]: " NEW_ADMIN_PASS
ADMIN_PASS=${NEW_ADMIN_PASS:-$ADMIN_PASSWORD}

# CLOUDFLARE
echo -e "\n4. ${CYAN}CLOUDFLARE TUNNEL${NC}: (Opcional) Para salir a internet sin abrir puertos."
read -p "   Tunnel Token [$CLOUDFLARE_TUNNEL_TOKEN]: " NEW_TUNNEL_TOKEN
TUNNEL_TOKEN=${NEW_TUNNEL_TOKEN:-$CLOUDFLARE_TUNNEL_TOKEN}

# --- GUARDAR EN .ENV ---
cat <<EOF > .env
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME
BOT_PORT=$FREE_BOT
FRONTEND_PORT=$FREE_FRONT
QDRANT_PORT=$FREE_DB

XAI_API_KEY=$XAI_KEY
XAI_MODEL=grok-beta
FB_PAGE_ACCESS_TOKEN=$FB_TOKEN
FB_VERIFY_TOKEN=$FB_VERIFY

APP_NAME="$APP_NAME"
ITEM_NAME="$ITEM_NAME"
TICKET_PREFIX="$TICKET_PREFIX"
ADMIN_PASSWORD="$ADMIN_PASS"
CLOUDFLARE_TUNNEL_TOKEN="$TUNNEL_TOKEN"
BUSINESS_ADDRESS="$BUSINESS_ADDRESS"
BUSINESS_PHONE="$BUSINESS_PHONE"
BUSINESS_TYPE="$BUSINESS_TYPE"
TIMEZONE=America/Hermosillo
SINGLE_TENANT_MODE=1
EOF

# --- CONFIGURACIÓN DEL PROMPT (SOUL) ---
echo -e ""
echo -e "${YELLOW}[ PASO 5: PERSONALIZANDO LA IA ]${NC}"
mkdir -p soul notebook data/baileys_auth data/temp_media

# Usar promptex.md como base si existe, si no, crear uno desde cero
if [ -f soul/promptex.md ]; then
    echo -e "   ✨ Usando plantilla promptex.md para generar el prompt real..."
    # Sustitución básica de variables en el prompt
    cp soul/promptex.md soul/prompt.md
    sed -i "s/\[NOMBRE_DEL_NEGOCIO\]/$APP_NAME/g" soul/prompt.md
    sed -i "s/\[UBICACION_FISICA\]/$BUSINESS_ADDRESS/g" soul/prompt.md
    sed -i "s/\[TELEFONO_PUBLICO\]/$BUSINESS_PHONE/g" soul/prompt.md
    sed -i "s/\[TIPO_DE_NEGOCIO\]/$BUSINESS_TYPE/g" soul/prompt.md
    sed -i "s/\[PRODUCTOS_O_SERVICIOS\]/$ITEM_NAME/g" soul/prompt.md
else
    echo -e "   📝 Generando prompt básico orientado a $BUSINESS_TYPE..."
cat <<EOF > soul/prompt.md
# EL ROL
Eres el Asesor Especializado de **$APP_NAME**. Tu misión es ayudar con información sobre **$ITEM_NAME** y gestionar solicitudes (tickets/citas) de forma profesional.

# INFORMACIÓN DE CONTACTO
- **Ubicación:** $BUSINESS_ADDRESS
- **Teléfono:** $BUSINESS_PHONE

# REGLAS ESTRICTAS
1. Tu fuente de verdad es la carpeta 'notebook/'. Si algo no está ahí, di que no tienes el dato.
2. Sé amable y proactivo para registrar el nombre y contacto del cliente.
3. Para cualquier cambio o registro, USA LAS HERRAMIENTAS.
4. Estamos en el sector: **$BUSINESS_TYPE**. Adapta tu lenguaje a este contexto.
EOF
fi

# --- PREPARANDO LA BASE DE CONOCIMIENTO (NOTEBOOK) ---
echo -e ""
echo -e "${YELLOW}[ PASO 6: BASE DE CONOCIMIENTO ]${NC}"
if [ ! -f notebook/index.md ] && [ ! -f notebook/ejemplo.md ]; then
    echo -e "   📁 Creando archivos iniciales en /notebook..."
    echo "# BIENVENIDOS A $APP_NAME" > notebook/index.md
    echo "Ofrecemos lo mejor en $ITEM_NAME." >> notebook/index.md
    echo "Ubicación: $BUSINESS_ADDRESS" >> notebook/index.md
    echo "Contacto: $BUSINESS_PHONE" >> notebook/index.md
    
    echo "Faq 1: ¿Cuáles son sus horarios?" > notebook/faqs.md
    echo "Respuesta: Atendemos de Lunes a Viernes de 9am a 6pm." >> notebook/faqs.md
fi

if [ ! -f data/tickets.json ]; then echo "[]" > data/tickets.json; fi

# --- GENERACIÓN DE DOCKER COMPOSE ---
cat <<EOF > docker-compose.yml
services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: \${COMPOSE_PROJECT_NAME}_qdrant
    ports:
      - "127.0.0.1:\${QDRANT_PORT}:6333"
    volumes:
      - ./qdrant_data:/qdrant/storage
    restart: always

  bot:
    build: .
    container_name: \${COMPOSE_PROJECT_NAME}_bot
    ports:
      - "127.0.0.1:\${BOT_PORT}:3000"
    env_file: .env
    environment:
      - PORT=3000
      - QDRANT_URL=http://qdrant:6333
    volumes:
      - ./notebook:/app/notebook
      - ./soul:/app/soul
      - ./data:/app/data
    depends_on:
      - qdrant
    restart: always

  frontend:
    build: ./frontend
    container_name: \${COMPOSE_PROJECT_NAME}_frontend
    ports:
      - "127.0.0.1:\${FRONTEND_PORT}:4173"
    environment:
      - FRONTEND_PORT=4173
      - FRONTEND_QDRANT_URL=http://qdrant:6333
      - BOT_BASE_URL=http://bot:3000
      - APP_NAME=\${APP_NAME}
    depends_on:
      - bot
    restart: always

  tunnel:
    image: cloudflare/cloudflared:latest
    container_name: \${COMPOSE_PROJECT_NAME}_tunnel
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=\${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      - frontend
      - bot
    restart: always
EOF

# --- LANZAMIENTO FINAL ---
echo -e ""
echo -e "${CYAN}====================================================${NC}"
type_text "¡Configuración completada con éxito!"
echo -e "Iniciando servicios con Docker Compose..."
echo -e "${CYAN}====================================================${NC}"

docker-compose down --remove-orphans 2>/dev/null
docker-compose up -d --build

IP_ADDR=$(hostname -I | awk '{print $1}')
echo -e ""
echo -e "${BLUE}====================================================${NC}"
echo -e "🚀 ¡Felicidades! $APP_NAME está en línea."
echo -e ""
echo -e "📍 Acceso Local:"
echo -e "   - Panel de Admin: ${GREEN}http://$IP_ADDR:$FREE_FRONT${NC}"
echo -e "   - Puerto del Bot: $FREE_BOT"
echo -e ""
echo -e "📚 Próximos pasos recomendados:"
echo -e "   1. Entra al Panel de Admin con tu contraseña."
echo -e "   2. Edita los archivos en la carpeta /notebook para darle más datos al Bot."
echo -e "   3. ¡Prueba a escribirle por WhatsApp o Messenger!"
echo -e "${BLUE}====================================================${NC}"
echo -en "${CYAN}SmartBis:${NC} "
type_text "Si necesitas más ayuda, ¡aquí estaré! Suerte con tu negocio."
echo -e "${BLUE}====================================================${NC}"
