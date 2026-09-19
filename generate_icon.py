from PIL import Image
import os

# 输入图片路径
input_path = r"D:\SYSTEM\拖拉机AI软件图标生成需求 (1).jpeg"
# 输出目录
output_dir = r"D:\project\bot\build"
os.makedirs(output_dir, exist_ok=True)

# 打开图片
img = Image.open(input_path)
print(f"原始图片尺寸: {img.size}, 模式: {img.mode}")

# 去除白色背景，转为透明
def remove_white_background(image):
    # 转为 RGBA 模式
    if image.mode != 'RGBA':
        image = image.convert('RGBA')
    
    pixels = image.load()
    width, height = image.size
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            # 白色或接近白色的像素设为透明
            if r > 240 and g > 240 and b > 240:
                pixels[x, y] = (r, g, b, 0)
    
    return image

# 去除白色背景
img = remove_white_background(img)

# 生成 icon.png (512x512，保持比例，居中放置在透明画布上)
def make_square(image, size):
    # 创建透明正方形画布
    square = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # 计算缩放比例，保持原始比例
    img_w, img_h = image.size
    scale = min(size / img_w, size / img_h) * 0.9  # 留 10% 边距
    new_w = int(img_w * scale)
    new_h = int(img_h * scale)
    # 缩放图片
    resized = image.resize((new_w, new_h), Image.LANCZOS)
    # 居中放置
    x = (size - new_w) // 2
    y = (size - new_h) // 2
    square.paste(resized, (x, y), resized)
    return square

# 生成 512x512 PNG
icon_png = make_square(img, 512)
png_path = os.path.join(output_dir, "icon.png")
icon_png.save(png_path, "PNG")
print(f"已生成: {png_path} ({icon_png.size})")

# 生成 icon.ico (包含多种尺寸)
ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ico_path = os.path.join(output_dir, "icon.ico")

# 生成各尺寸并保存为 ICO
icon_images = []
for size in ico_sizes:
    sized = make_square(img, size[0])
    icon_images.append(sized)

# 保存为 ICO（使用最大尺寸作为基础，Windows 会自动缩放）
icon_images[-1].save(ico_path, format='ICO', sizes=ico_sizes)
print(f"已生成: {ico_path} (包含尺寸: {ico_sizes})")

print("\n图标生成完成！")
