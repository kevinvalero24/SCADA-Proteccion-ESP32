#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <PZEM004Tv30.h>
#include <time.h>
#include <ArduinoJson.h>
#include <SocketIOclient.h>

// --- CONFIGURACION DE RED (CASA) ---
const char *ssid = "MOVISTAR - ESPERANZA";
const char *password = "V1d4L3$18";

// --- IP DEL SERVIDOR BACKEND ---
String ip_de_tu_pc = "192.168.1.4";
String url_telemetria = "http://" + ip_de_tu_pc + ":3000/api/telemetria";

// --- CONFIGURACION DE HARDWARE ---
PZEM004Tv30 pzem(Serial2, 16, 17);
const int RELE_PIN = 4;

SocketIOclient socketIO;

// --- VARIABLES GLOBALES DE ESTADO ---
bool ordenEncendidoHMI = true;  // Estado deseado del relé
unsigned long ultimoReporte = 0;
bool fallaDeRed = false;        // Memoria del estado de protección

// ---> VARIABLES DE DOMÓTICA (RELOJ INTELIGENTE) <---
String modoActual = "manual";   // Puede ser "manual" o "horario"
String horaInicio = "";         // "HH:MM" (ej. "18:30")
String horaFin = "";            // "HH:MM" (ej. "06:00")
bool accionHorariaEjecutada = false; // Evita mandar la orden miles de veces en el mismo minuto

// Configuración de Zona Horaria (Colombia es UTC-5)
const long gmtOffset_sec = -5 * 3600; 
const int daylightOffset_sec = 0;

// =================================================================
// FUNCION MAESTRA DE ENCLAVAMIENTO (CERO RETARDO)
// =================================================================
void actualizarContactor()
{
  if (fallaDeRed)
  {
    digitalWrite(RELE_PIN, LOW); // PROTECCION: Falla de red, abre el circuito (OFF)
  }
  else
  {
    // RED ESTABLE: Obedece a la lógica interna (Manual o Automática)
    if (ordenEncendidoHMI)
    {
      digitalWrite(RELE_PIN, HIGH); // ON: Contactor energizado o en reposo (según su cableado)
    }
    else
    {
      digitalWrite(RELE_PIN, LOW);  // OFF: Abre el circuito
    }
  }
}

// =================================================================
// RECEPTOR DE RADIO (WEBSOCKETS) EN TIEMPO REAL
// =================================================================
void socketIOEvent(socketIOmessageType_t type, uint8_t *payload, size_t length)
{
  switch (type)
  {
  case sIOtype_DISCONNECT:
    Serial.println("[Radio] OFFLINE: Perdida de senal con el SCADA.");
    break;
  case sIOtype_CONNECT:
    Serial.println("[Radio] ONLINE: Conectado al SCADA exitosamente.");
    socketIO.send(sIOtype_CONNECT, "/");
    break;
  case sIOtype_EVENT:
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);

    if (error) return;

    const char *evento = doc[0];
    if (String(evento) == "estado_mando")
    {
      // 1. Extraemos el modo de operación
      if (doc[1].containsKey("modo")) {
          modoActual = doc[1]["modo"].as<String>();
      }

      Serial.print("[HMI] MODO CAMBIADO A: ");
      Serial.println(modoActual);

      // 2. Lógica MODO MANUAL
      if (modoActual == "manual") {
          bool comandoRele = doc[1]["forzar_rele"];
          if (ordenEncendidoHMI != comandoRele) {
              ordenEncendidoHMI = comandoRele;
              Serial.print("[HMI] ORDEN MANUAL: ");
              Serial.println(ordenEncendidoHMI ? "PRENDER" : "APAGAR");
              actualizarContactor();
          }
      }
      // 3. Lógica MODO HORARIO (Captura de horas)
      else if (modoActual == "horario") {
          if (doc[1].containsKey("hora_inicio")) {
              horaInicio = doc[1]["hora_inicio"].as<String>();
          }
          if (doc[1].containsKey("hora_fin")) {
              horaFin = doc[1]["hora_fin"].as<String>();
          }
          
          Serial.print("[HMI] PROGRAMACIÓN RECIBIDA -> ON: [");
          Serial.print(horaInicio);
          Serial.print("] | OFF: [");
          Serial.print(horaFin);
          Serial.println("]");
          
          // Al recibir nueva programación, habilitamos la ejecución
          accionHorariaEjecutada = false; 
      }
    }
    break;
  }
}

// =================================================================
// FUNCIÓN PARA REVISAR EL RELOJ Y ACTUAR
// =================================================================
void verificarRelojDomotico() {
    // Si no estamos en modo horario, salimos rápido
    if (modoActual != "horario") return;

    struct tm timeinfo;
    if (!getLocalTime(&timeinfo)) {
        return; // Si no hay reloj, no hacemos nada
    }

    // Formatear la hora actual en texto "HH:MM" para compararla fácil
    char horaActualChar[6];
    strftime(horaActualChar, sizeof(horaActualChar), "%H:%M", &timeinfo);
    String horaActual = String(horaActualChar);

    // Evita actuar si ya hicimos el cambio en este mismo minuto
    static String ultimoMinutoEvaluado = "";
    if (horaActual == ultimoMinutoEvaluado) return;

    // --- EVALUAR ENCENDIDO ---
    if (horaInicio != "" && horaActual == horaInicio && !ordenEncendidoHMI) {
        Serial.println("[TEMPORIZADOR] ¡Es la hora de ENCENDER!");
        ordenEncendidoHMI = true;
        actualizarContactor();
        ultimoMinutoEvaluado = horaActual;
    }
    
    // --- EVALUAR APAGADO ---
    if (horaFin != "" && horaActual == horaFin && ordenEncendidoHMI) {
        Serial.println("[TEMPORIZADOR] ¡Es la hora de APAGAR!");
        ordenEncendidoHMI = false;
        actualizarContactor();
        ultimoMinutoEvaluado = horaActual;
    }
}

void setup()
{
  Serial.begin(115200);

  pinMode(RELE_PIN, OUTPUT);
  digitalWrite(RELE_PIN, HIGH);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);

  Serial.println("\n--- Iniciando Sistema Domótico ---");
  WiFi.begin(ssid, password);

  int intentosWiFi = 0;
  while (WiFi.status() != WL_CONNECTED && intentosWiFi < 20)
  {
    delay(500);
    Serial.print(".");
    intentosWiFi++;
  }

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println("\nRed conectada exitosamente!");
    
    // Configuramos el reloj con el offset de Colombia (-5 horas)
    configTime(gmtOffset_sec, daylightOffset_sec, "pool.ntp.org", "time.nist.gov");

    int intentosNTP = 0;
    struct tm timeinfo;
    while (!getLocalTime(&timeinfo) && intentosNTP < 10)
    {
      delay(500);
      intentosNTP++;
    }
    Serial.println("Reloj sincronizado (Hora Local Colombia).");

    socketIO.begin(ip_de_tu_pc, 3000, "/socket.io/?EIO=4");
    socketIO.onEvent(socketIOEvent);
  }
}

void loop()
{
  socketIO.loop();
  
  // El microcontrolador vigila el reloj en cada ciclo
  verificarRelojDomotico();

  if (millis() - ultimoReporte >= 5000)
  {
    ultimoReporte = millis();

    float voltage = pzem.voltage();
    float current = pzem.current();
    float power = pzem.power();
    float energy = pzem.energy();
    float frequency = pzem.frequency();
    float pf = pzem.pf();

    bool estadoAlarma = false;
    bool sensorError = false;

    if (isnan(voltage))
    {
      Serial.println("Error Critico: Perdida de senal del sensor PZEM.");
      fallaDeRed = true;
      estadoAlarma = true;
      sensorError = true;
    }
    else
    {
      if (voltage < 110.0 || voltage > 135.0)
      {
        fallaDeRed = true;
        estadoAlarma = true;
        sensorError = false;
        Serial.println(">>> ¡FALLA DE RED DETECTADA! (Bloqueo) <<<");
      }
      else
      {
        fallaDeRed = false;
        estadoAlarma = false;
        sensorError = false;
      }
    }

    actualizarContactor();

    if (WiFi.status() == WL_CONNECTED)
    {
      struct tm timeinfo;
      String estampaString = "";

      if (getLocalTime(&timeinfo))
      {
        char estampaTiempo[30];
        // Aquí pasamos la estampa a formato UTC puro para MongoDB
      // Pasamos la estampa con el ajuste horario explícito de Colombia (-05:00)
        strftime(estampaTiempo, sizeof(estampaTiempo), "%Y-%m-%dT%H:%M:%S.000-05:00", &timeinfo);
        estampaString = String(estampaTiempo);
      }
      else
      {
        estampaString = "Sin_Sincronizar";
      }

      HTTPClient http;
      http.begin(url_telemetria);
      http.addHeader("Content-Type", "application/json");

      String datosJSON = "{\"mac_address\": \"24:0A:C4:00:01:10\", \"circuit_id\": \"breaker_prueba_01\", \"voltage\": " + (isnan(voltage) ? "0" : String(voltage)) +
                         ", \"current\": " + (isnan(current) ? "0" : String(current)) +
                         ", \"power\": " + (isnan(power) ? "0" : String(power)) +
                         ", \"energy\": " + (isnan(energy) ? "0" : String(energy)) +
                         ", \"frequency\": " + (isnan(frequency) ? "0" : String(frequency)) +
                         ", \"power_factor\": " + (isnan(pf) ? "0" : String(pf)) +
                         ", \"alarm_state\": " + (estadoAlarma ? "true" : "false") +
                         ", \"sensor_error\": " + (sensorError ? "true" : "false") +
                         ", \"timestamp\": \"" + estampaString + "\"}";

      int codigoRespuesta = http.POST(datosJSON);
      if (codigoRespuesta < 0)
      {
        Serial.print("Error POST: ");
        Serial.println(codigoRespuesta);
      }
      http.end();
    }
    else
    {
      WiFi.reconnect();
    }
  }
}