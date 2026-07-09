#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <PZEM004Tv30.h>
#include <time.h> 
#include <ArduinoJson.h>
#include <SocketIOclient.h>

// --- CONFIGURACION DE RED (CASA) ---
const char* ssid = "MOVISTAR - ESPERANZA"; 
const char* password = "V1d4L3$18"; 

// --- IP DEL SERVIDOR BACKEND ---
String ip_de_tu_pc = "192.168.1.4"; 
String url_telemetria = "http://" + ip_de_tu_pc + ":3000/api/telemetria";

// --- CONFIGURACION DE HARDWARE ---
PZEM004Tv30 pzem(Serial2, 16, 17);
const int RELE_PIN = 4;

SocketIOclient socketIO;

// --- VARIABLES GLOBALES DE ESTADO ---
bool ordenEncendidoHMI = true; 
unsigned long ultimoReporte = 0;
bool fallaDeRed = false; // Memoria del estado de la red electrica

// =================================================================
// FUNCION MAESTRA DE ENCLAVAMIENTO (CERO RETARDO)
// =================================================================
void actualizarContactor() {
  if (fallaDeRed) {
    digitalWrite(RELE_PIN, LOW); // PROTECCION: Falla de red, abre el circuito (OFF)
  } else {
    // RED ESTABLE: Obedece al HMI de Angular
    if (ordenEncendidoHMI) {
      digitalWrite(RELE_PIN, HIGH); // HMI ON: Contactor en reposo NC (ON)
    } else {
      digitalWrite(RELE_PIN, LOW);  // HMI OFF: Contactor energizado y abierto (OFF)
    }
  }
}

// =================================================================
// RECEPTOR DE RADIO (WEBSOCKETS) EN TIEMPO REAL
// =================================================================
void socketIOEvent(socketIOmessageType_t type, uint8_t * payload, size_t length) {
  switch(type) {
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
      
      if(error) return; 
      
      const char* evento = doc[0]; 
      if (String(evento) == "estado_mando") {
        bool comandoRele = doc[1]["forzar_rele"];
        
        if (ordenEncendidoHMI != comandoRele) {
          ordenEncendidoHMI = comandoRele;
          Serial.print("[HMI] ORDEN MANUAL RECIBIDA: ");
          Serial.println(ordenEncendidoHMI ? "ENCENDER" : "APAGAR");
          
          // ¡LA SOLUCION! Disparamos el hardware en el mismo milisegundo que llega la orden
          actualizarContactor(); 
        }
      }
      break;
  }
}

void setup() {
  Serial.begin(115200);
  
  pinMode(RELE_PIN, OUTPUT);
  digitalWrite(RELE_PIN, HIGH); 
  
  WiFi.mode(WIFI_STA); 
  WiFi.disconnect();   
  delay(100);

  Serial.println("\n--- Iniciando Sistema SCADA Bidireccional ---");
  WiFi.begin(ssid, password);

  int intentosWiFi = 0;
  while (WiFi.status() != WL_CONNECTED && intentosWiFi < 20) {
    delay(500);
    Serial.print(".");
    intentosWiFi++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nRed conectada exitosamente!");
    configTime(0, 0, "pool.ntp.org", "time.nist.gov"); 
    
    int intentosNTP = 0;
    struct tm timeinfo;
    while (!getLocalTime(&timeinfo) && intentosNTP < 10) {
      delay(500);
      intentosNTP++;
    }
    Serial.println("Reloj del sistema sincronizado en UTC.");
    
    socketIO.begin(ip_de_tu_pc, 3000, "/socket.io/?EIO=4");
    socketIO.onEvent(socketIOEvent);
  }
}

void loop() {
  socketIO.loop();

  if (millis() - ultimoReporte >= 5000) {
    ultimoReporte = millis();

    float voltage = pzem.voltage();
    float current = pzem.current();
    float power = pzem.power();
    float energy = pzem.energy();
    float frequency = pzem.frequency();
    float pf = pzem.pf();

    bool estadoAlarma = false;
    bool sensorError = false;

    if(isnan(voltage)){
        Serial.println("Error Critico: Perdida de senal del sensor PZEM.");
        fallaDeRed = true;
        estadoAlarma = true;
        sensorError = true;          
    } else {
        if (voltage < 110.0 || voltage > 135.0) {
          fallaDeRed = true;
          estadoAlarma = true; 
          sensorError = false;
          Serial.println(">>> ¡FALLA DE RED DETECTADA! (Bloqueo de seguridad) <<<");
        } else {
          fallaDeRed = false;
          estadoAlarma = false;
          sensorError = false;
        }
    }
    
    // Revalidamos la posicion del rele cada 5 segundos por seguridad
    actualizarContactor();

    if(WiFi.status() == WL_CONNECTED){
        struct tm timeinfo;
        String estampaString = "";
        
        if(getLocalTime(&timeinfo)){
          char estampaTiempo[30];
          strftime(estampaTiempo, sizeof(estampaTiempo), "%Y-%m-%dT%H:%M:%S.000Z", &timeinfo);
          estampaString = String(estampaTiempo);
        } else {
          estampaString = "Sin_Sincronizar";
        }

        HTTPClient http;
        http.begin(url_telemetria);
        http.addHeader("Content-Type", "application/json");

        String datosJSON = "{\"mac_address\": \"24:0A:C4:00:01:10\", \"circuit_id\": \"1\", \"voltage\": " + (isnan(voltage) ? "0" : String(voltage)) + 
                           ", \"current\": " + (isnan(current) ? "0" : String(current)) + 
                           ", \"power\": " + (isnan(power) ? "0" : String(power)) + 
                           ", \"energy\": " + (isnan(energy) ? "0" : String(energy)) +
                           ", \"frequency\": " + (isnan(frequency) ? "0" : String(frequency)) +
                           ", \"power_factor\": " + (isnan(pf) ? "0" : String(pf)) +
                           ", \"alarm_state\": " + (estadoAlarma ? "true" : "false") + 
                           ", \"sensor_error\": " + (sensorError ? "true" : "false") + 
                           ", \"timestamp\": \"" + estampaString + "\"}";
        
        int codigoRespuesta = http.POST(datosJSON);
        if (codigoRespuesta < 0) {
          Serial.print("Error POST: ");
          Serial.println(codigoRespuesta);
        }
        http.end();
    } else {
        WiFi.reconnect(); 
    }
  }
}