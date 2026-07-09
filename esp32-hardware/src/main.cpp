#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <PZEM004Tv30.h>
#include <time.h> 

// --- CONFIGURACIÓN DE RED (CASA) ---
const char* ssid = "MOVISTAR - ESPERANZA"; 
const char* password = "V1d4L3$18"; 

// --- IP DEL SERVIDOR BACKEND ---
String ip_de_tu_pc = "192.168.1.4"; 
String url_telemetria = "http://" + ip_de_tu_pc + ":3000/api/telemetria";

// --- CONFIGURACIÓN DE HARDWARE ---
PZEM004Tv30 pzem(Serial2, 16, 17); // Pines RX/TX conectados al PZEM
const int RELE_PIN = 4;            // Pin de disparo para el Relé de 5V

void setup() {
  Serial.begin(115200);
  
  // Inicialización del Relé con lógica inversa (Active-LOW)
  pinMode(RELE_PIN, OUTPUT);
  digitalWrite(RELE_PIN, HIGH); // Inicia en reposo (contacto cerrado en NC para potencia)
  
  WiFi.mode(WIFI_STA); 
  WiFi.disconnect();   
  delay(100);

  Serial.println("\n--- Iniciando Sistema SCADA Resiliente de Alta Disponibilidad ---");
  WiFi.begin(ssid, password);

  // Intentamos conectar al Wi-Fi por un máximo de 10 segundos para no bloquear el arranque
  int intentosWiFi = 0;
  while (WiFi.status() != WL_CONNECTED && intentosWiFi < 20) {
    delay(500);
    Serial.print(".");
    intentosWiFi++;
  }

  // Si hay red, sincronizamos el reloj atómico en UTC (Base de tiempo universal)
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n¡Red conectada exitosamente!");
    configTime(0, 0, "pool.ntp.org", "time.nist.gov"); // 0 offset para hora UTC limpia
    
    int intentosNTP = 0;
    struct tm timeinfo;
    while (!getLocalTime(&timeinfo) && intentosNTP < 10) {
      delay(500);
      intentosNTP++;
    }
    Serial.println("Reloj del sistema sincronizado en UTC.");
  } else {
    Serial.println("\n[ADVERTENCIA] Red no disponible. Iniciando en MODO OFFLINE (Protección activa).");
  }
}

void loop() {
  // Lectura de variables eléctricas
  float voltage = pzem.voltage();
  float current = pzem.current();
  float power = pzem.power();
  float energy = pzem.energy();
  float frequency = pzem.frequency();
  float pf = pzem.pf();

  // Banderas lógicas de control y diagnóstico
  bool estadoAlarma = false;
  bool sensorError = false;

  // =========================================================================
  // BLOQUE 1: PRIORIDAD CRÍTICA - PROTECCIÓN ELECTRÓNICA LOCAL (EDGE)
  // =========================================================================
  if(isnan(voltage)){
      Serial.println("Error Crítico: Pérdida de señal del sensor PZEM.");
      digitalWrite(RELE_PIN, LOW); // Fail-Safe: Abre el contactor Chint por seguridad
      estadoAlarma = true;
      sensorError = true;          // Bandera de diagnóstico activa
  } else {
      Serial.println("----------------------------------------");
      Serial.print("Voltaje de Red: "); Serial.print(voltage); Serial.println(" V");
      
      // Calibración de Setpoints de protección (Ajustado a 120V para tus pruebas)
      if (voltage < 110.0 || voltage > 135.0) {
        digitalWrite(RELE_PIN, LOW); // LOW abre el circuito de potencia
        estadoAlarma = true; 
        sensorError = false;
        Serial.println(">>> ¡FALLA DE RED DETECTADA! RELÉ FÍSICO ACCIONADO <<<");
      } else {
        digitalWrite(RELE_PIN, HIGH); // HIGH mantiene el contactor Chint energizado
        estadoAlarma = false;
        sensorError = false;
        Serial.println("--- Tensión estable. Red en operación nominal. ---");
      }
      Serial.println("----------------------------------------");
  }

  // =========================================================================
  // BLOQUE 2: TAREA SECUNDARIA - TELEMETRÍA ASÍNCRONA (SCADA)
  // =========================================================================
  if(WiFi.status() == WL_CONNECTED){
      struct tm timeinfo;
      String estampaString = "";
      
      // Formateamos la estampa de tiempo UTC con formato ISO estándar
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

      // Inyección de variables de estado ("Single Source of Truth")
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
        Serial.print("Error de enlace con Node.js. Código: ");
        Serial.println(codigoRespuesta);
      }
      http.end();
  } else {
      Serial.println("[MODO OFFLINE] Resguardando circuito de potencia de forma autónoma...");
      WiFi.reconnect(); // Intenta reconexión en segundo plano sin congelar el lazo
  }

  delay(5000); // Muestreo periódico industrial de 5 segundos
}