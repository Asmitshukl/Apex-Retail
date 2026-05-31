FROM alpine:3.20

WORKDIR /models

COPY pipeline/models/yolov8n.pt ./yolov8n.pt
COPY pipeline/models/staff_classifier.onnx ./staff_classifier.onnx
COPY pipeline/models/staff_classifier.onnx.data ./staff_classifier.onnx.data
COPY pipeline/models/classes.txt ./classes.txt

CMD ["sh", "-c", "mkdir -p /target && cp -f /models/* /target/ && ls -lh /target"]
