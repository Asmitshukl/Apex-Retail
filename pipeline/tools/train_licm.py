import os
import torch
import torch.nn as nn
import torchvision.transforms as transforms
import torchvision.datasets as datasets
import torchvision.models as models
from torch.utils.data import DataLoader

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASET_DIR = os.path.join(BASE_DIR, "data", "licm_dataset")
OUTPUT_PATH = os.path.join(BASE_DIR, "models", "staff_classifier.onnx")
os.makedirs(os.path.join(BASE_DIR, "models"), exist_ok=True)

transform_train = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.RandomHorizontalFlip(),
    transforms.ColorJitter(brightness=0.2, contrast=0.2),
    transforms.ToTensor(),
    transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225]),
])
transform_val = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485,0.456,0.406],[0.229,0.224,0.225]),
])

train_ds = datasets.ImageFolder(os.path.join(DATASET_DIR,"train"), transform_train)
val_ds   = datasets.ImageFolder(os.path.join(DATASET_DIR,"valid"), transform_val)
print(f"Classes: {train_ds.classes}")
print(f"Train: {len(train_ds)} | Val: {len(val_ds)}")

train_loader = DataLoader(train_ds, batch_size=32, shuffle=True,  num_workers=0)
val_loader   = DataLoader(val_ds,   batch_size=32, shuffle=False, num_workers=0)

model = models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
model.fc = nn.Linear(model.fc.in_features, len(train_ds.classes))
device = torch.device("cpu")
model = model.to(device)

criterion = nn.CrossEntropyLoss()
optimizer = torch.optim.Adam(model.parameters(), lr=1e-4)
scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=5, gamma=0.5)

EPOCHS = 15
best_val_acc = 0.0

for epoch in range(EPOCHS):
    model.train()
    correct = total = 0
    for imgs, labels in train_loader:
        imgs, labels = imgs.to(device), labels.to(device)
        optimizer.zero_grad()
        outputs = model(imgs)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()
        _, predicted = outputs.max(1)
        correct += predicted.eq(labels).sum().item()
        total += labels.size(0)
    train_acc = correct / total * 100

    model.eval()
    correct = total = 0
    with torch.no_grad():
        for imgs, labels in val_loader:
            imgs, labels = imgs.to(device), labels.to(device)
            outputs = model(imgs)
            _, predicted = outputs.max(1)
            correct += predicted.eq(labels).sum().item()
            total += labels.size(0)
    val_acc = correct / total * 100
    scheduler.step()
    print(f"Epoch {epoch+1:02d}/{EPOCHS} | Train: {train_acc:.1f}% | Val: {val_acc:.1f}%")
    if val_acc > best_val_acc:
        best_val_acc = val_acc
        torch.save(model.state_dict(), "/tmp/best_licm.pth")
        print(f"  -> Best model saved (val_acc={val_acc:.1f}%)")

print(f"\nBest val accuracy: {best_val_acc:.1f}%")
model.load_state_dict(torch.load("/tmp/best_licm.pth", weights_only=True))
model.eval()

dummy = torch.randn(1, 3, 224, 224)
torch.onnx.export(
    model, dummy, OUTPUT_PATH,
    input_names=["images"],
    output_names=["output"],
    dynamic_axes={"images": {0: "batch"}},
    opset_version=18
)
print(f"ONNX exported to: {OUTPUT_PATH}")

classes_path = os.path.join(BASE_DIR, "models", "classes.txt")
with open(classes_path, "w") as f:
    for c in train_ds.classes:
        f.write(c + "\n")
print(f"Class order: {train_ds.classes}")
print("Done.")
